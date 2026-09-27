/**
 * The guide's voice. Off by default; the toggle lives on the wall and under
 * the sphere on the welcome screen.
 *
 * Lines are read by ElevenLabs through /api/speak (the key never reaches the
 * browser). If that route is unavailable, the browser's own speech engine
 * takes over for the rest of the visit. While audio plays, a live loudness
 * level is published so the sphere's mouth can move with the words.
 */

let enabled = false;
let engine: "eleven" | "browser" | "unknown" = "unknown";
const listeners = new Set<(on: boolean) => void>();
const levelListeners = new Set<(level: number) => void>();

const clips = new Map<string, Promise<string | null>>(); // line -> blob URL
let audio: HTMLAudioElement | null = null;
let analyser: AnalyserNode | null = null;
let ctx: AudioContext | null = null;
let levelRaf = 0;
let finishCurrent: (() => void) | null = null;
let seq = 0;

export function setVoice(on: boolean) {
  enabled = on;
  if (!on) stop();
  if (on) unlock();
  listeners.forEach((l) => l(on));
}

export function voiceOn() {
  return enabled;
}

export function onVoice(fn: (on: boolean) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** 0 to 1, roughly how loud the guide is right now. */
export function onLevel(fn: (level: number) => void) {
  levelListeners.add(fn);
  return () => {
    levelListeners.delete(fn);
  };
}

function emit(level: number) {
  levelListeners.forEach((l) => l(level));
}

/** Create the audio graph inside a click, so autoplay rules are satisfied. */
function unlock() {
  if (typeof window === "undefined") return;
  if (!audio) {
    audio = new Audio();
    audio.preload = "auto";
    audio.crossOrigin = "anonymous";
  }
  if (!ctx) {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
      const src = ctx.createMediaElementSource(audio);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;
      src.connect(analyser);
      analyser.connect(ctx.destination);
    } catch {
      ctx = null;
      analyser = null;
    }
  }
  void ctx?.resume();
}

function fetchClip(text: string): Promise<string | null> {
  const got = clips.get(text);
  if (got) return got;
  const p = fetch(`/api/speak?t=${encodeURIComponent(text)}`)
    .then(async (r) => {
      if (!r.ok) {
        // No key, bad key or quota: stop asking and use the browser's voice.
        if (r.status === 503 || r.status === 502 || r.status === 429) engine = "browser";
        return null;
      }
      engine = "eleven";
      return URL.createObjectURL(await r.blob());
    })
    .catch(() => null);
  clips.set(text, p);
  p.then((url) => {
    if (!url) clips.delete(text);
  });
  return p;
}

/** Warm the cache for lines that are about to be said. */
export function prefetch(lines: string[]) {
  if (!enabled || engine === "browser" || typeof window === "undefined") return;
  lines.forEach((l) => l.trim() && fetchClip(l.trim()));
}

export function stop() {
  if (typeof window === "undefined") return;
  audio?.pause();
  window.speechSynthesis?.cancel();
  cancelAnimationFrame(levelRaf);
  emit(0);
  finishCurrent?.();
  finishCurrent = null;
}

function meter() {
  if (!analyser) return;
  const data = new Uint8Array(analyser.fftSize);
  const tick = () => {
    analyser!.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    emit(Math.min(1, Math.sqrt(sum / data.length) * 4));
    levelRaf = requestAnimationFrame(tick);
  };
  levelRaf = requestAnimationFrame(tick);
}

function browserSpeak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.96;
    u.pitch = 0.9;
    const voices = window.speechSynthesis.getVoices();
    // Match the ElevenLabs voice: a woman, British first. Windows, Chrome and macOS names.
    const pick =
      voices.find((v) => /Google UK English Female|Microsoft (Libby|Sonia|Hazel)|Serena|Kate/i.test(v.name)) ??
      voices.find((v) => /Samantha|Microsoft (Aria|Jenny|Zira)|Google US English/i.test(v.name)) ??
      voices.find((v) => v.lang.startsWith("en"));
    if (pick) u.voice = pick;
    let on = true;
    const finish = () => {
      if (!on) return;
      on = false;
      clearTimeout(guard);
      emit(0);
      finishCurrent = null;
      resolve();
    };
    // Fake a level so the mouth still moves.
    const wobble = () => {
      if (!on) return;
      emit(0.25 + Math.random() * 0.45);
      setTimeout(wobble, 90);
    };
    u.onstart = wobble;
    u.onend = finish;
    u.onerror = finish;
    finishCurrent = finish;
    // Some browsers never fire onend. Never let a silent engine stall the page.
    const guard = setTimeout(finish, 1500 + text.split(" ").length * 480);
    window.speechSynthesis.speak(u);
  });
}

/**
 * Say one line. Resolves when it has been said (or right away when the voice
 * is off), so the page can wait for the words before writing the next line.
 */
export async function speak(text: string): Promise<void> {
  const line = text.trim();
  if (!enabled || !line || typeof window === "undefined") return;
  stop();
  const mine = ++seq;
  if (engine !== "browser") {
    const url = await fetchClip(line);
    // Voice switched off, or a newer line started while this one loaded.
    if (!enabled || mine !== seq) return;
    if (url && audio) {
      return new Promise<void>((resolve) => {
        const a = audio!;
        const guard = setTimeout(() => done(), 20_000);
        const done = () => {
          clearTimeout(guard);
          a.onended = a.onerror = null;
          cancelAnimationFrame(levelRaf);
          emit(0);
          finishCurrent = null;
          resolve();
        };
        finishCurrent = done;
        a.onended = a.onerror = done;
        a.src = url;
        a.play().then(meter, done);
      });
    }
  }
  return browserSpeak(line);
}
