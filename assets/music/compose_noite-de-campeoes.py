# Trilha ORIGINAL "Noite de Campeões" para La Velada Boxing — composição própria, sintetizada.
import numpy as np
from scipy.signal import butter, sosfilt, fftconvolve
SR = 44100
BPM = 104
BEAT = 60 / BPM
BAR = 4 * BEAT
rng = np.random.default_rng(7)

def midi(n): return 440.0 * 2 ** ((n - 69) / 12)
NOTE = {}
names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"]
for o in range(1, 8):
    for i, nm in enumerate(names): NOTE[f"{nm}{o}"] = 12 * (o + 1) + i
NOTE.update({k.replace("A#","Bb").replace("D#","Eb"): v for k, v in list(NOTE.items())})

TOTAL_BARS = 4 + 8 + 8 + 4  # intro, tensão, tema, ponte/volta
L = int(SR * BAR * TOTAL_BARS) + SR * 3
mix = {k: np.zeros(L) for k in ["brass","strings","bass","drums","timp","horn"]}

def env(n, a, d, s, r, sus_len):
    A = int(a*SR); D = int(d*SR); R = int(r*SR); S = max(0, n - A - D - R)
    e = np.concatenate([np.linspace(0,1,max(A,1)), np.linspace(1,s,max(D,1)), np.full(S, s), np.linspace(s,0,max(R,1))])
    return e[:n] if len(e) >= n else np.pad(e, (0, n-len(e)))

def add(track, start_s, sig):
    i = int(start_s * SR); j = min(L, i + len(sig)); mix[track][i:j] += sig[:j-i]

def brass(freq, dur, vel=1.0, bright=1.0):
    n = int((dur + 0.15) * SR); t = np.arange(n) / SR
    vib = 1 + 0.004 * np.sin(2*np.pi*5.2*t) * np.clip(t/0.3, 0, 1)
    ph = 2*np.pi*freq*np.cumsum(vib)/SR
    out = np.zeros(n)
    att = np.clip(t/0.06, 0, 1)
    for h in range(1, 14):
        if freq*h > 9000: break
        amp = (1.0/h**(1.3 - 0.5*bright*att)) 
        out += amp*np.sin(h*ph)
    out *= env(n, 0.05, 0.15, 0.8, 0.12, dur)
    return 0.18*vel*out

def strings(freq, dur, vel=1.0):
    n = int((dur + 0.4) * SR); t = np.arange(n)/SR
    out = np.zeros(n)
    for det in (-0.12, 0.0, 0.11):
        f = freq * 2**(det/12)
        out += 2*((t*f) % 1) - 1
    sos = butter(2, 2200, 'low', fs=SR, output='sos')
    out = sosfilt(sos, out) * env(n, 0.25, 0.2, 0.85, 0.4, dur)
    return 0.05*vel*out

def bass(freq, dur, vel=1.0):
    n = int((dur + 0.05)*SR); t = np.arange(n)/SR
    out = 2*((t*freq) % 1) - 1 + 0.6*np.sin(2*np.pi*freq*t)
    sos = butter(2, 700, 'low', fs=SR, output='sos')
    return 0.16*vel*sosfilt(sos, out)*env(n, 0.005, 0.08, 0.6, 0.04, dur)

def kick(vel=1.0):
    n = int(0.35*SR); t = np.arange(n)/SR
    f = 50 + 90*np.exp(-t*25)
    return 0.55*vel*np.sin(2*np.pi*np.cumsum(f)/SR)*np.exp(-t*9)

def snare(vel=1.0):
    n = int(0.25*SR); t = np.arange(n)/SR
    sos = butter(2, [1200, 7000], 'band', fs=SR, output='sos')
    noise = sosfilt(sos, rng.standard_normal(n))
    return 0.22*vel*(noise*np.exp(-t*18) + 0.5*np.sin(2*np.pi*190*t)*np.exp(-t*30))

def timp(freq, vel=1.0, dur=1.2):
    n = int(dur*SR); t = np.arange(n)/SR
    f = freq*(1 + 0.04*np.exp(-t*12))
    tone = np.sin(2*np.pi*np.cumsum(f)/SR) + 0.4*np.sin(2*np.pi*np.cumsum(f*1.5)/SR)
    noise = sosfilt(butter(2, 400, 'low', fs=SR, output='sos'), rng.standard_normal(n))
    return 0.35*vel*(tone*np.exp(-t*3.2) + 0.5*noise*np.exp(-t*25))

def cymbal(vel=1.0):
    n = int(2.0*SR); t = np.arange(n)/SR
    sos = butter(2, 5000, 'high', fs=SR, output='sos')
    return 0.12*vel*sosfilt(sos, rng.standard_normal(n))*np.exp(-t*2.2)

def chord_notes(root, kind):
    r = NOTE[root]
    return [r, r + (3 if kind == "m" else 4), r + 7]

T0 = 0.0
# ---------- INTRO (4 compassos): rufar de tímpanos crescendo + pedal de metais em Ré ----------
for b in range(4):
    start = T0 + b*BAR
    for k in range(16):  # rufar em semicolcheias, crescendo
        v = 0.25 + 0.75*((b*16 + k)/64)
        add("timp", start + k*BEAT/4, timp(midi(NOTE["D2"]), v*0.6, 0.5))
    add("horn", start, brass(midi(NOTE["D3"]), BAR*0.95, 0.5 + 0.15*b, 0.6))
    add("horn", start, brass(midi(NOTE["A3"]), BAR*0.95, 0.35 + 0.12*b, 0.6))
# golpe final da intro
add("drums", T0 + 4*BAR - BEAT/2, snare(1.0)); add("drums", T0 + 4*BAR - BEAT/4, snare(1.0))

# ---------- A: TENSÃO em Ré menor (8 compassos) ----------
TA = T0 + 4*BAR
progA = [("D3","m"),("Bb2","M"),("F2","M"),("C3","M"),("D3","m"),("Bb2","M"),("G2","m"),("A2","M")]
for b, (root, kind) in enumerate(progA):
    s = TA + b*BAR
    for n in chord_notes(root, kind): add("strings", s, strings(midi(n+12), BAR*0.98, 0.9))
    for e in range(8):  # baixo em colcheias, motor da cena de treino
        add("bass", s + e*BEAT/2, bass(midi(NOTE[root] - (12 if NOTE[root] > 45 else 0)), BEAT/2*0.85, 1.0 if e % 2 == 0 else 0.75))
    for q in range(4):
        add("drums", s + q*BEAT, kick(0.9 if q in (0,2) else 0.5))
        if q in (1,3): add("drums", s + q*BEAT, snare(0.8))
        add("drums", s + q*BEAT + BEAT*0.75, snare(0.25))  # caixa marcial "fantasma"
    # chamada de trompas (motivo original) nos compassos ímpares
    if b % 2 == 1:
        r = NOTE[root] + 12
        add("horn", s + BEAT*2, brass(midi(r), BEAT*0.9, 0.7))
        add("horn", s + BEAT*3, brass(midi(r + 7), BEAT*0.9, 0.8))
add("timp", TA + 8*BAR - BEAT, timp(midi(NOTE["A2"]), 1.0))

# ---------- B: TEMA HEROICO em Ré maior (8 compassos) ----------
TB = TA + 8*BAR
progB = [("D3","M"),("G2","M"),("B2","m"),("A2","M"),("D3","M"),("G2","M"),("E3","m"),("D3","M")]
melody = [  # melodia original: (nota, duração em tempos)
    [("A4",1.5),("F#4",0.5),("A4",1),("D5",1)],
    [("B4",1.5),("A4",0.5),("G4",1),("B4",1)],
    [("F#4",1),("D4",0.5),("F#4",0.5),("B4",2)],
    [("A4",1),("G4",0.5),("F#4",0.5),("E4",2)],
    [("A4",0.5),("A4",0.5),("D5",1),("E5",1),("F#5",1)],
    [("G5",1.5),("F#5",0.5),("E5",1),("D5",1)],
    [("E5",1),("B4",1),("C#5",1),("E5",1)],
    [("D5",4)],
]
add("drums", TB, cymbal(1.0))
for b, (root, kind) in enumerate(progB):
    s = TB + b*BAR
    notes = chord_notes(root, kind)
    if b == 6:  # Em (2 tempos) + A (2 tempos)
        for n in chord_notes("E3","m"): add("strings", s, strings(midi(n+12), BAR/2, 1.0))
        for n in chord_notes("A2","M"): add("strings", s+BAR/2, strings(midi(n+12), BAR/2, 1.0))
    else:
        for n in notes: add("strings", s, strings(midi(n+12), BAR*0.98, 1.0))
    for e in range(8):
        rt = root if not (b == 6 and e >= 4) else "A2"
        add("bass", s + e*BEAT/2, bass(midi(NOTE[rt] - (12 if NOTE[rt] > 45 else 0)), BEAT/2*0.85, 1.0))
    for q in range(4):
        add("drums", s + q*BEAT, kick(1.0 if q in (0,2) else 0.6))
        if q in (1,3): add("drums", s + q*BEAT, snare(1.0))
    t = s
    for nm, d in melody[b]:
        add("brass", t, brass(midi(NOTE[nm]), d*BEAT*0.95, 1.0, 1.0))
        add("brass", t, brass(midi(NOTE[nm]-12), d*BEAT*0.95, 0.45, 0.7))  # dobra na oitava de baixo
        t += d*BEAT
    if b in (3, 7): add("timp", s + 3*BEAT, timp(midi(NOTE["A2"] if b == 3 else NOTE["D2"]), 1.0))
add("drums", TB + 7*BAR, cymbal(0.8))

# ---------- PONTE (4 compassos): acordes de metais em hits, volta pra intro ----------
TC = TB + 8*BAR
hits = [("D3","M"),("Bb2","M"),("C3","M"),("A2","M")]
for b, (root, kind) in enumerate(hits):
    s = TC + b*BAR
    for n in chord_notes(root, kind):
        add("horn", s, brass(midi(n+12), BEAT*1.4, 0.9))
        add("horn", s + BEAT*2.5, brass(midi(n+12), BEAT*1.2, 0.8))
    add("timp", s, timp(midi(NOTE[root] - (12 if NOTE[root] > 45 else 0)), 1.0))
    add("timp", s + BEAT*2.5, timp(midi(NOTE[root] - (12 if NOTE[root] > 45 else 0)), 0.8))
    for e in range(8): add("drums", s + e*BEAT/2, snare(0.3 + 0.08*e))
add("drums", TC + 4*BAR - BEAT/2, cymbal(0.9))

# ---------- mixagem ----------
gains = {"brass":1.0,"horn":0.85,"strings":0.9,"bass":0.9,"drums":0.9,"timp":0.8}
dry = sum(mix[k]*g for k, g in gains.items())
# reverb de arena (impulso exponencial)
ir_len = int(1.8*SR); tt = np.arange(ir_len)/SR
ir = rng.standard_normal(ir_len)*np.exp(-tt*3.0); ir[0] = 0; ir /= np.sqrt(np.sum(ir**2))
wet = fftconvolve(dry, ir)[:L]
song = dry*0.82 + wet*0.30
loop_len = int(SR*BAR*TOTAL_BARS)
# cauda do fim cai por cima do começo -> loop sem emenda
tail = song[loop_len:]
song = song[:loop_len].copy(); song[:len(tail)] += tail
song = np.tanh(song*1.4)/np.tanh(1.4)
song /= np.max(np.abs(song))*1.05
# estéreo leve (atraso de 12ms no canal direito)
d = int(0.012*SR)
st = np.stack([song, np.concatenate([song[-d:], song[:-d]])], axis=1)
import wave
with wave.open("/home/claude/music/theme.wav","wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((st*32000).astype(np.int16).tobytes())
print("duração: %.1fs" % (loop_len/SR))
