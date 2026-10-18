import { execFile } from "node:child_process";
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
}

/**
 * Assembles and muxes the video with context-aware ambience, music, fades, and optional branding.
 * Ensures strict synchronization, zero audio clipping, and mobile-optimized MP4 delivery.
 */
export async function finalizeVideoWithAudio(options: FinalizeVideoOptions): Promise<void> {
  const { videoPath, outputPath, prompt, duration, fps, logoPath, isSilent } = options;

  const fadeOutStart = Math.max(0.5, duration - 1.5);
  const fadeOutDuration = Math.min(1.5, duration - fadeOutStart);

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
    ];
    await execFileAsync("ffmpeg", ffmpegArgs);
    return;
  }

  const profile = detectSceneAudioProfile(prompt);
  const inputs: string[] = ["-y", "-stream_loop", "-1", "-i", videoPath];
  let audioInputCount = 0;

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

  // Smooth seamless video motion looping:
  // When target duration is > 6s, construct a smooth ping-pong (forward-reverse) motion loop
  // so the video displays continuous, uninterrupted motion without jarring cut jumps.
  let currentVideoStream = "0:v";
  if (duration > 6) {
    filterSteps.push(
      "[0:v]split=2[v_fwd][v_rev_in]",
      "[v_rev_in]reverse[v_rev]",
      "[v_fwd][v_rev]concat=n=2:v=1:a=0[v_loop]",
    );
    currentVideoStream = "[v_loop]";
  }

  // Audio mix & master:
  // Normalize integrated loudness to broadcast standard -16 LUFS (Apple/YouTube/mobile standard)
  // and True Peak to -1.5 dBTP with clean fade-in and fade-out.
  if (audioInputCount > 1) {
    const audioTags = Array.from({ length: audioInputCount }, (_, i) => `[${i + 1}:a]`).join("");
    filterSteps.push(
      `${audioTags}amix=inputs=${audioInputCount}:duration=first:dropout_transition=2[amixed]`,
    );
    filterSteps.push(
      `[amixed]volume=2.2,loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:ss=0:d=0.6,afade=t=out:st=${fadeOutStart}:d=${fadeOutDuration}[aout]`,
    );
  } else if (audioInputCount === 1) {
    filterSteps.push(
      `[1:a]volume=2.2,loudnorm=I=-16:TP=-1.5:LRA=11,afade=t=in:ss=0:d=0.6,afade=t=out:st=${fadeOutStart}:d=${fadeOutDuration}[aout]`,
    );
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

  inputs.push("-filter_complex", filterSteps.join(";"));
  inputs.push("-map", currentVideoStream);

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

  await execFileAsync("ffmpeg", inputs);
}
