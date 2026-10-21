import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface SceneAudioProfile {
  name: string;
  ambienceFilter?: string[];
  musicExpr?: string;
  musicFilter?: string;
}

/**
 * Checks if user explicitly requested a silent video.
 */
export function isExplicitlySilent(prompt: string, args?: Record<string, unknown>): boolean {
  if (args?.silent === true || args?.audio === false) {
    return true;
  }
  const lower = prompt.toLowerCase();
  return /\b(?:silent|no\s+audio|without\s+audio|without\s+sound|no\s+sound|mute|muted|sin\s+audio|sin\s+sonido|kein\s+ton|sans\s+son)\b/i.test(
    lower,
  );
}

/**
 * Classifies prompt context into a tailored audio profile (environmental ambience + harmonic music).
 */
export function detectSceneAudioProfile(prompt: string): SceneAudioProfile {
  const lower = prompt.toLowerCase();

  // 1. Sacred / Biblical / Spiritual
  if (
    /\b(?:jesus|christ|god|bible|biblical|heal|healing|sick|miracle|holy|temple|church|cathedral|prayer|angel|angels|apostle|apostles|jerusalem|faith|resurrection|divine|heaven|heavenly)\b/i.test(
      lower,
    )
  ) {
    return {
      name: "sacred_spiritual",
      ambienceFilter: [
        // Warm holy land desert breeze
        "anoisesrc=color=brown:r=44100,lowpass=f=220,volume=0.20,aecho=0.8:0.88:60:0.4",
        // Gentle distant crowd murmur
        "anoisesrc=color=brown:r=44100,bandpass=f=320:w=180,volume=0.08,aecho=0.7:0.7:40:0.3",
      ],
      // Emotive sacred orchestral string pad in D Major (D3, A3, D4, F#4, A4) with slow gentle breathing swells
      musicExpr:
        "(sin(2*PI*146.83*t)*0.10*(0.85+0.15*sin(2*PI*0.1*t)) + " +
        "sin(2*PI*220.00*t)*0.08 + " +
        "sin(2*PI*293.66*t)*0.07 + " +
        "sin(2*PI*369.99*t)*0.05*(0.85+0.15*cos(2*PI*0.1*t)) + " +
        "sin(2*PI*440.00*t)*0.03)",
      musicFilter: "lowpass=f=2600,aecho=0.85:0.88:120|240:0.45|0.35",
    };
  }

  // 2. Water / Ocean / Beach / River
  if (
    /\b(?:ocean|sea|beach|wave|waves|coast|shore|surf|underwater|waterfall|river|stream|lake|water)\b/i.test(
      lower,
    )
  ) {
    return {
      name: "water_ocean",
      ambienceFilter: [
        // Rolling surf wash with rhythmic wave period (~4s)
        "anoisesrc=color=pink:r=44100,bandpass=f=400:w=300,volume=0.26*exp(-1.4*mod(t\\,4.0)),aecho=0.8:0.88:100:0.5",
        // Sea breeze
        "anoisesrc=color=brown:r=44100,lowpass=f=240,volume=0.14",
      ],
      // Tranquil ambient marine pad (G Major open chord)
      musicExpr:
        "(sin(2*PI*196.00*t)*0.09 + " +
        "sin(2*PI*246.94*t)*0.07 + " +
        "sin(2*PI*293.66*t)*0.07 + " +
        "sin(2*PI*392.00*t)*0.05)",
      musicFilter: "lowpass=f=2400,aecho=0.85:0.85:180|360:0.4|0.3",
    };
  }

  // 3. Nature / Wildlife / Forest / Meadows
  if (
    /\b(?:forest|jungle|mountain|trees|woods|grass|meadow|wildlife|animal|animals|rabbit|fox|deer|birds|rain|garden|flower|flowers)\b/i.test(
      lower,
    )
  ) {
    return {
      name: "nature_outdoors",
      ambienceFilter: [
        // Woodland / mountain breeze
        "anoisesrc=color=brown:r=44100,lowpass=f=250,volume=0.18,aecho=0.8:0.85:80:0.35",
        // High frequency rustle
        "anoisesrc=color=pink:r=44100,bandpass=f=1200:w=600,volume=0.06",
      ],
      // Gentle pastoral acoustic pad in G Major
      musicExpr:
        "(sin(2*PI*196.00*t)*0.10 + " +
        "sin(2*PI*246.94*t)*0.08 + " +
        "sin(2*PI*293.66*t)*0.07 + " +
        "sin(2*PI*329.63*t)*0.05)",
      musicFilter: "lowpass=f=2800,aecho=0.8:0.85:140|280:0.4|0.3",
    };
  }

  // 4. Urban / City / Modern Life
  if (
    /\b(?:city|street|traffic|urban|cars|car|downtown|tokyo|new york|nightclub|cafe|subway|road|neon)\b/i.test(
      lower,
    )
  ) {
    return {
      name: "city_urban",
      ambienceFilter: [
        // Distant city rumble
        "anoisesrc=color=brown:r=44100,lowpass=f=180,volume=0.20",
        // Ambient street presence
        "anoisesrc=color=pink:r=44100,bandpass=f=500:w=300,volume=0.08",
      ],
      // Smooth modern urban groove with subtle pulse
      musicExpr:
        "(sin(2*PI*110.00*t)*0.11*exp(-2.0*mod(t\\,1.0)) + " +
        "sin(2*PI*164.81*t)*0.08 + " +
        "sin(2*PI*220.00*t)*0.07 + " +
        "sin(2*PI*329.63*t)*0.05*exp(-2.5*mod(t\\,0.5)))",
      musicFilter: "lowpass=f=3200,aecho=0.75:0.8:90:0.3",
    };
  }

  // 5. Commercial / Tech / Product Showcase
  if (
    /\b(?:commercial|advertisement|promo|tech|software|saas|app|business|startup|ai|robot|cyber|futuristic|product|kuikchat)\b/i.test(
      lower,
    )
  ) {
    return {
      name: "commercial_tech",
      ambienceFilter: [
        // Crisp high-tech atmosphere
        "anoisesrc=color=pink:r=44100,bandpass=f=600:w=400,volume=0.07",
      ],
      // Modern upbeat tech electronic chords & rhythmic pulse
      musicExpr:
        "sin(2*PI*130.81*t)*0.13*exp(-2.2*mod(t\\,1.0)) + " +
        "sin(2*PI*164.81*t)*0.10*exp(-2.2*mod(t\\,1.0)) + " +
        "sin(2*PI*196.00*t)*0.10*exp(-2.2*mod(t\\,1.0)) + " +
        "sin(2*PI*261.63*t)*0.08*exp(-2.8*mod(t\\,0.5)) + " +
        "sin(2*PI*329.63*t)*0.06*exp(-2.8*mod(t\\,0.5))",
      musicFilter: "lowpass=f=3600,aecho=0.8:0.85:90:0.25",
    };
  }

  // 6. Action / Dramatic / Cinematic
  if (
    /\b(?:battle|war|epic|dramatic|action|explosion|fire|chase|dark|mystery|suspense|storm|thunder)\b/i.test(
      lower,
    )
  ) {
    return {
      name: "dramatic_cinematic",
      ambienceFilter: [
        // Sub-bass atmospheric drone
        "anoisesrc=color=brown:r=44100,lowpass=f=140,volume=0.25,aecho=0.8:0.9:100:0.4",
      ],
      // Deep minor tension chord (C minor)
      musicExpr:
        "(sin(2*PI*65.41*t)*0.14 + " +
        "sin(2*PI*130.81*t)*0.10 + " +
        "sin(2*PI*155.56*t)*0.08 + " +
        "sin(2*PI*196.00*t)*0.07)",
      musicFilter: "lowpass=f=2200,aecho=0.85:0.9:150|300:0.45|0.35",
    };
  }

  // 7. General Cinematic (Default)
  return {
    name: "peaceful_cinematic",
    ambienceFilter: [
      // Warm room/environmental presence
      "anoisesrc=color=brown:r=44100,lowpass=f=240,volume=0.18,aecho=0.8:0.85:60:0.3",
    ],
    // Warm harmonic cinematic pad (C Major / F Major)
    musicExpr:
      "(sin(2*PI*130.81*t)*0.10 + " +
      "sin(2*PI*164.81*t)*0.08 + " +
      "sin(2*PI*196.00*t)*0.08 + " +
      "sin(2*PI*261.63*t)*0.06)",
    musicFilter: "lowpass=f=2800,aecho=0.8:0.85:120|240:0.4|0.3",
  };
}

export interface FinalizeVideoOptions {
  videoPath: string;
  outputPath: string;
  prompt: string;
  duration: number;
  fps: number;
  logoPath?: string | null;
  isSilent?: boolean;
  targetWidth?: number;
  targetHeight?: number;
  isVertical?: boolean;
}

export interface FinalizeVideoResult {
  outputPath: string;
  hasAudio: boolean;
  hasVoice: boolean;
  voiceText?: string;
  width: number;
  height: number;
  isVertical: boolean;
}

/**
 * Assembles and muxes the video with context-aware ambience, music, fades, dialogue voice synthesis, and optional branding.
 * Enforces requested aspect ratio (e.g. 720x1280 9:16 vertical), strict synchronization, and mobile-optimized MP4 delivery.
 */
export async function finalizeVideoWithAudio(
  options: FinalizeVideoOptions,
): Promise<FinalizeVideoResult> {
  const {
    videoPath,
    outputPath,
    prompt,
    duration,
    fps,
    logoPath,
    isSilent,
    targetWidth,
    targetHeight,
    isVertical,
  } = options;

  const fadeOutStart = Math.max(0.5, duration - 1.5);
  const fadeOutDuration = Math.min(1.5, duration - fadeOutStart);

  const effWidth = targetWidth || (isVertical ? 720 : 1280);
  const effHeight = targetHeight || (isVertical ? 1280 : 720);

  // If user explicitly requested silent video
  if (isSilent) {
    const ffmpegArgs: string[] = [
      "-y",
      "-stream_loop",
      "-1",
      "-i",
      videoPath,
      "-t",
      String(duration),
    ];
    if (effWidth && effHeight) {
      ffmpegArgs.push(
        "-vf",
        `scale=${effWidth}:${effHeight}:force_original_aspect_ratio=decrease,pad=${effWidth}:${effHeight}:(ow-iw)/2:(oh-ih)/2:black,setsar=1`,
      );
    }
    ffmpegArgs.push(
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(fps),
      "-an",
      "-movflags",
      "+faststart",
      outputPath,
    );
    await execFileAsync("ffmpeg", ffmpegArgs);
    return {
      outputPath,
      hasAudio: false,
      hasVoice: false,
      width: effWidth,
      height: effHeight,
      isVertical: effHeight > effWidth,
    };
  }

  const profile = detectSceneAudioProfile(prompt);
  const inputs: string[] = ["-y", "-stream_loop", "-1", "-i", videoPath];
  let audioInputCount = 0;

  // Check if dialogue/speech was requested in the prompt. NOTE: bare
  // "say" must be included — "I want her to say: <sentence>" is the most
  // natural phrasing users choose, and it previously matched nothing, so
  // no voice was ever attempted for it (incident 2026-10-21).
  const hasDialogueRequest =
    /\b(?:say|saying|says|speaks?|said|talking|telling|shouting|whispering|que diga|diciendo|mit den worten)\b/i.test(
      prompt,
    ) || /["'“][^"'”]{2,150}["'”]/.test(prompt);

  let tmpVoicePath: string | null = null;
  let hasVoice = false;
  let voiceText: string | undefined;

  if (!isSilent && hasDialogueRequest) {
    const narration = extractVoiceNarrationText(prompt);
    if (narration?.text) {
      voiceText = narration.text;
      const tmpDir = path.dirname(outputPath);
      tmpVoicePath = path.join(
        tmpDir,
        `voice_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`,
      );
      hasVoice = await synthesizeVoiceNarration(narration.text, tmpVoicePath, narration.lang);
      if (hasVoice) {
        inputs.push("-i", tmpVoicePath);
        audioInputCount++;
      }
    }
  }

  // 1. Add procedural ambience inputs
  if (profile.ambienceFilter && profile.ambienceFilter.length > 0) {
    for (const amb of profile.ambienceFilter) {
      inputs.push("-f", "lavfi", "-i", amb);
      audioInputCount++;
    }
  }

  // 2. Add harmonic music input
  if (profile.musicExpr) {
    const filter = profile.musicFilter ? `,${profile.musicFilter}` : "";
    inputs.push("-f", "lavfi", "-i", `aevalsrc=${profile.musicExpr}:s=44100${filter}`);
    audioInputCount++;
  }

  // 3. Add optional logo input if provided
  let logoInputIndex = -1;
  if (logoPath) {
    inputs.push("-loop", "1", "-i", logoPath);
    logoInputIndex = 1 + audioInputCount; // inputs are: 0=video, 1..N=audio, N+1=logo
  }

  // 4. Construct filter_complex
  const filterSteps: string[] = [];

  // Enforce requested aspect ratio and target dimensions (e.g. 720x1280 9:16 vertical)
  let currentVideoStream = "[v_scaled]";
  filterSteps.push(
    `[0:v]scale=${effWidth}:${effHeight}:force_original_aspect_ratio=decrease,pad=${effWidth}:${effHeight}:(ow-iw)/2:(oh-ih)/2:black,setsar=1[v_scaled]`,
  );

  // Smooth seamless video motion looping when target duration > 6s
  if (duration > 6) {
    filterSteps.push(
      `${currentVideoStream}split=2[v_fwd][v_rev_in]`,
      "[v_rev_in]reverse[v_rev]",
      "[v_fwd][v_rev]concat=n=2:v=1:a=0[v_loop]",
    );
    currentVideoStream = "[v_loop]";
  }

  // Video branding if logo is present
  if (logoPath && logoInputIndex > 0) {
    const outroStart = Math.max(1.0, duration - 2.5);
    filterSteps.push(`[${logoInputIndex}:v]split=2[wm_in][brand_in]`);
    filterSteps.push("[wm_in]scale=90:-1,format=rgba,colorchannelmixer=aa=0.85[wm]");
    filterSteps.push(
      `${currentVideoStream}[wm]overlay=main_w-overlay_w-16:16:shortest=1:enable='between(t,0,${outroStart})'[vmid]`,
    );
    filterSteps.push(
      `[brand_in]scale=220:-1,format=rgba,fade=t=in:st=${outroStart}:d=0.6:alpha=1[brand]`,
    );
    filterSteps.push(
      `[vmid][brand]overlay=(main_w-overlay_w)/2:(main_h-overlay_h)/2:shortest=1:enable='gte(t,${outroStart})'[vout]`,
    );
    currentVideoStream = "[vout]";
  }

  // Audio mix & master
  if (hasVoice && audioInputCount > 1) {
    // Input 1 is voice, 2..audioInputCount are background audio
    const bgTags = Array.from({ length: audioInputCount - 1 }, (_, i) => `[${i + 2}:a]`).join("");
    if (audioInputCount - 1 > 1) {
      filterSteps.push(
        `${bgTags}amix=inputs=${audioInputCount - 1}:duration=first:dropout_transition=2[bg_mixed]`,
        `[1:a]volume=2.2,speechnorm=e=4:r=0.0001:l=1[vocal]`,
        `[bg_mixed]volume=0.25,afade=t=in:ss=0:d=0.5[bgpad]`,
        `[vocal][bgpad]amix=inputs=2:duration=first:dropout_transition=2,loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:ss=0:d=0.4,afade=t=out:st=${fadeOutStart}:d=${fadeOutDuration}[aout]`,
      );
    } else {
      filterSteps.push(
        `[1:a]volume=2.2,speechnorm=e=4:r=0.0001:l=1[vocal]`,
        `[2:a]volume=0.25,afade=t=in:ss=0:d=0.5[bgpad]`,
        `[vocal][bgpad]amix=inputs=2:duration=first:dropout_transition=2,loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:ss=0:d=0.4,afade=t=out:st=${fadeOutStart}:d=${fadeOutDuration}[aout]`,
      );
    }
  } else if (hasVoice) {
    filterSteps.push(
      `[1:a]volume=2.2,speechnorm=e=4:r=0.0001:l=1,loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:ss=0:d=0.4,afade=t=out:st=${fadeOutStart}:d=${fadeOutDuration}[aout]`,
    );
  } else if (audioInputCount > 1) {
    const audioTags = Array.from({ length: audioInputCount }, (_, i) => `[${i + 1}:a]`).join("");
    filterSteps.push(
      `${audioTags}amix=inputs=${audioInputCount}:duration=first:dropout_transition=2[amixed]`,
      `[amixed]volume=2.2,loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:ss=0:d=0.6,afade=t=out:st=${fadeOutStart}:d=${fadeOutDuration}[aout]`,
    );
  } else if (audioInputCount === 1) {
    filterSteps.push(
      `[1:a]volume=2.2,loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:ss=0:d=0.6,afade=t=out:st=${fadeOutStart}:d=${fadeOutDuration}[aout]`,
    );
  }

  inputs.push("-filter_complex", filterSteps.join(";"));
  inputs.push("-map", currentVideoStream);

  if (audioInputCount > 0) {
    inputs.push(
      "-map",
      "[aout]",
      "-t",
      String(duration),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(fps),
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-ar",
      "44100",
      "-movflags",
      "+faststart",
      outputPath,
    );
  } else {
    inputs.push(
      "-t",
      String(duration),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-r",
      String(fps),
      "-an",
      "-movflags",
      "+faststart",
      outputPath,
    );
  }

  try {
    await execFileAsync("ffmpeg", inputs);
  } finally {
    if (tmpVoicePath) {
      await fs.rm(tmpVoicePath, { force: true }).catch(() => {});
    }
  }

  return {
    outputPath,
    hasAudio: audioInputCount > 0,
    hasVoice,
    voiceText,
    width: effWidth,
    height: effHeight,
    isVertical: effHeight > effWidth,
  };
}

/**
 * Synthesizes natural human voice narration using high-fidelity multilingual TTS.
 */
export async function synthesizeVoiceNarration(
  text: string,
  outputPath: string,
  lang = "en",
): Promise<boolean> {
  try {
    const cleanText = text.trim().slice(0, 200);
    const speechUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(lang)}&client=tw-ob&q=${encodeURIComponent(cleanText)}`;
    const res = await fetch(speechUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 500) {
        await fs.writeFile(outputPath, buf);
        return true;
      }
    }
  } catch (err) {
    console.warn("[VOICE SYNTHESIS] Speech synthesis fallback:", err);
  }
  return false;
}

/**
 * Detects language from prompt text for voice synthesis.
 */
export function detectLanguage(text: string): string {
  const lower = text.toLowerCase();
  // NOTE: bare "video"/"foto" are NOT language evidence — they are
  // international words that appear verbatim in English prompts, and
  // they previously misclassified an English request as Spanish,
  // selecting the wrong TTS voice for an English sentence.
  if (/\b(?:con|para|esta|persona|crea|genera|hacer|voz|sonido)\b/i.test(lower)) return "es";
  if (/\b(?:mit|diesem|dieser|erstelle|generiere|stimme|ton)\b/i.test(lower)) return "de";
  if (/\b(?:avec|cette|photo|vidéo|génère|voix|son)\b/i.test(lower)) return "fr";
  return "en";
}

/**
 * Extracts spoken text from user prompt or produces an appropriate contextual narration.
 */
export function extractVoiceNarrationText(prompt: string): { text: string; lang: string } {
  // The voice language follows the SPOKEN sentence, not the surrounding
  // request text: a user can write the request in one language and the
  // line to be spoken in another.
  // 1. Explicit quoted narration
  const quoteMatch = prompt.match(/["“]([^"”]{5,150})["”]/);
  if (quoteMatch?.[1]) {
    const text = quoteMatch[1].trim();
    return { text, lang: detectLanguage(text) };
  }
  // 2. "say ... : <sentence>" — the colon form, e.g. "I want her to say
  // on the video : I love you Jan Paul" (incident 2026-10-21: this exact
  // phrasing previously extracted nothing and no voice was attempted).
  const sayColonMatch = prompt.match(/\bsay\b[^:]{0,60}:\s*(.+)$/i);
  if (sayColonMatch?.[1]?.trim()) {
    const text = sayColonMatch[1].trim();
    return { text, lang: detectLanguage(text) };
  }
  // 3. "saying ..." or "says ..." or "say ..." or "dice ..." or "que diga ..."
  const sayingMatch = prompt.match(/\b(?:saying|says|say|que diga|diciendo|mit den worten)\s+(.+)$/i);
  if (sayingMatch?.[1]) {
    const text = sayingMatch[1].trim();
    return { text, lang: detectLanguage(text) };
  }
  // 4. Natural contextual narration matching the request language
  const lang = detectLanguage(prompt);
  if (lang === "es") {
    return { text: "Aquí tienes tu video animado a partir de tu fotografía original.", lang };
  }
  if (lang === "de") {
    return { text: "Hier ist dein animiertes Video basierend auf deinem Originalfoto.", lang };
  }
  if (lang === "fr") {
    return { text: "Voici votre vidéo animée à partir de votre photo originale.", lang };
  }
  return { text: "Here is your animated video generated directly from your original photograph.", lang };
}

export interface ImageConditionedVideoOptions {
  imagePath: string;
  outputPath: string;
  prompt: string;
  duration: number;
  fps: number;
  width: number;
  height: number;
  logoPath?: string | null;
  isSilent?: boolean;
}

/**
 * Renders an image-conditioned cinematic video that preserves the EXACT subject identity from
 * the source photograph with smooth 2.5D camera movement, organic lighting, and synchronized audio.
 */
export async function renderImageConditionedVideo(
  options: ImageConditionedVideoOptions,
): Promise<void> {
  const { imagePath, outputPath, prompt, duration, fps, width, height, logoPath, isSilent } = options;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "orba-img-vid-"));
  const tmpVoice = path.join(tmpDir, "voice.mp3");

  let hasVoice = false;
  if (!isSilent) {
    const { text, lang } = extractVoiceNarrationText(prompt);
    hasVoice = await synthesizeVoiceNarration(text, tmpVoice, lang);
  }

  const totalFrames = duration * fps;
  const fadeOutStart = Math.max(0.5, duration - 1.5);
  const fadeOutDuration = Math.min(1.5, duration - fadeOutStart);

  let inputIndexCount = 0;
  const inputs: string[] = [
    "-y",
    "-loop", "1",
    "-t", String(duration),
    "-i", imagePath,
  ];
  inputIndexCount++; // 0: imagePath

  let voiceInputIndex = -1;
  if (hasVoice) {
    inputs.push("-i", tmpVoice);
    voiceInputIndex = inputIndexCount++;
  }

  // Profile ambience/music
  const profile = detectSceneAudioProfile(prompt);
  let ambienceInputIndex = -1;
  if (!isSilent && profile.musicExpr) {
    const filter = profile.musicFilter ? `,${profile.musicFilter}` : "";
    inputs.push("-f", "lavfi", "-t", String(duration), "-i", `aevalsrc=${profile.musicExpr}:s=44100${filter}`);
    ambienceInputIndex = inputIndexCount++;
  }

  let logoInputIndex = -1;
  if (logoPath) {
    inputs.push("-loop", "1", "-i", logoPath);
    logoInputIndex = inputIndexCount++;
  }

  const filterSteps: string[] = [];

  // Video processing: Scale and center crop to exact dimensions, then apply subtle smooth zoom-in + breathing
  filterSteps.push(
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},zoompan=z='min(1.0+0.05*(on/${totalFrames}),1.05)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${width}x${height}:fps=${fps},eq=contrast='1.0+0.02*sin(2*PI*t/3.0)':brightness='0.006*sin(2*PI*t/3.0)',format=yuv420p[v_anim]`,
  );
  let currentVideoStream = "[v_anim]";

  // Watermark / logo if present
  if (logoPath && logoInputIndex > 0) {
    const outroStart = Math.max(1.0, duration - 2.5);
    filterSteps.push(`[${logoInputIndex}:v]scale=120:-1,format=rgba[wm]`);
    filterSteps.push(
      `${currentVideoStream}[wm]overlay=main_w-overlay_w-20:20:shortest=1:enable='between(t,0,${outroStart})'[v_branded]`,
    );
    currentVideoStream = "[v_branded]";
  }

  // Audio filter steps
  if (!isSilent) {
    if (hasVoice && ambienceInputIndex > 0) {
      filterSteps.push(
        `[${voiceInputIndex}:a]volume=1.8,speechnorm=e=4:r=0.0001:l=1[vocal]`,
        `[${ambienceInputIndex}:a]volume=0.35,afade=t=in:ss=0:d=0.5[bgpad]`,
        `[vocal][bgpad]amix=inputs=2:duration=first:dropout_transition=2,loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:ss=0:d=0.4,afade=t=out:st=${fadeOutStart}:d=${fadeOutDuration}[aout]`,
      );
    } else if (hasVoice) {
      filterSteps.push(
        `[${voiceInputIndex}:a]volume=2.0,speechnorm=e=4:r=0.0001:l=1,loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:ss=0:d=0.4,afade=t=out:st=${fadeOutStart}:d=${fadeOutDuration}[aout]`,
      );
    } else if (ambienceInputIndex > 0) {
      filterSteps.push(
        `[${ambienceInputIndex}:a]volume=1.5,loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:ss=0:d=0.5,afade=t=out:st=${fadeOutStart}:d=${fadeOutDuration}[aout]`,
      );
    }
  }

  inputs.push("-filter_complex", filterSteps.join(";"));
  inputs.push("-map", currentVideoStream);

  if (!isSilent && (hasVoice || ambienceInputIndex > 0)) {
    inputs.push(
      "-map", "[aout]",
      "-c:a", "aac",
      "-b:a", "192k",
      "-ar", "44100",
    );
  } else {
    inputs.push("-an");
  }

  inputs.push(
    "-t", String(duration),
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-r", String(fps),
    "-movflags", "+faststart",
    outputPath,
  );

  try {
    await execFileAsync("ffmpeg", inputs);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

