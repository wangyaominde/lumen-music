import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../api';
import { useAuth } from '../store/auth';

const PIN_LENGTH = 6;

interface Particle {
  id: number;
  value: string;
  ox: number; oy: number; oz: number;
  current2DX: number; current2DY: number;
  isChosen: boolean;
  targetX: number; targetY: number;
  scale: number;
  alpha: number;
}

interface SphereState {
  particles: Particle[];
  rotation: number;
  baseSpeed: number;
  isExtracting: boolean;
  width: number;
  height: number;
}

const SPHERE_CONFIG = {
  particleCount: 220,
  radius: 130,
  baseSpeed: 0.0022,
  burstSpeed: 0.10,
  extractEase: 0.06,
  perspective: 320
};

function makeParticles(): Particle[] {
  const out: Particle[] = [];
  const N = SPHERE_CONFIG.particleCount;
  for (let i = 0; i < N; i++) {
    const phi = Math.acos(-1 + (2 * i) / N);
    const theta = Math.sqrt(N * Math.PI) * phi;
    const r = SPHERE_CONFIG.radius;
    out.push({
      id: i,
      value: Math.floor(Math.random() * 10).toString(),
      ox: r * Math.cos(theta) * Math.sin(phi),
      oy: r * Math.sin(theta) * Math.sin(phi),
      oz: r * Math.cos(phi),
      current2DX: 0, current2DY: 0,
      isChosen: false,
      targetX: 0, targetY: 0,
      scale: 1, alpha: 1
    });
  }
  return out;
}

// Pre-render each digit glyph at native canvas resolution. Drawing via
// drawImage is dramatically faster than per-particle fillText, and avoids the
// font-state churn that dominates canvas profiles.
function buildGlyphAtlas(dpr: number): Map<string, HTMLCanvasElement> {
  const atlas = new Map<string, HTMLCanvasElement>();
  const baseSize = 28; // logical px — particles scale this with drawImage
  const padding = 6;
  for (let i = 0; i < 10; i++) {
    const ch = i.toString();
    const c = document.createElement('canvas');
    const w = (baseSize + padding * 2);
    const h = (baseSize + padding * 2);
    c.width = w * dpr;
    c.height = h * dpr;
    const cx = c.getContext('2d');
    if (!cx) continue;
    cx.scale(dpr, dpr);
    cx.font = `bold ${baseSize}px "SF Mono", "JetBrains Mono", monospace`;
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    cx.fillStyle = '#fff';
    cx.fillText(ch, w / 2, h / 2);
    atlas.set(ch, c);
  }
  return atlas;
}

export function LoginPage() {
  const phase = useAuth(s => s.phase);
  const setPhase = useAuth(s => s.setPhase);
  const isSetup = phase === 'setup';

  // Setup has two stages (set, then confirm); login has one.
  const [setupStage, setSetupStage] = useState<'set' | 'confirm'>('set');
  const [firstPin, setFirstPin] = useState<string>('');

  const [digits, setDigits] = useState<string[]>(() => Array(PIN_LENGTH).fill(''));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errored, setErrored] = useState(false);

  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sphereRef = useRef<SphereState | null>(null);
  const groupRef = useRef<HTMLDivElement | null>(null);

  // ---- Canvas particle sphere (perf-tuned) ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    // Cap DPR — full retina (3x) renders 9× the pixels for negligible quality
    // gain on monochrome glyphs.
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const atlas = buildGlyphAtlas(dpr);
    // Tinted variants reused at runtime to avoid per-frame globalAlpha churn
    // for the chosen-particle glow.
    const greenAtlas = (() => {
      const a = new Map<string, HTMLCanvasElement>();
      atlas.forEach((src, k) => {
        const c = document.createElement('canvas');
        c.width = src.width; c.height = src.height;
        const cx = c.getContext('2d');
        if (!cx) return;
        cx.drawImage(src, 0, 0);
        cx.globalCompositeOperation = 'source-in';
        cx.fillStyle = '#2ed573';
        cx.fillRect(0, 0, c.width, c.height);
        a.set(k, c);
      });
      return a;
    })();
    // Glyph atlas was rendered at 28px logical; we'll draw at proportional sizes.
    const GLYPH_BASE = 28 + 6 * 2; // includes padding

    const state: SphereState = {
      particles: makeParticles(),
      rotation: 0,
      baseSpeed: reduceMotion ? 0.0008 : SPHERE_CONFIG.baseSpeed,
      isExtracting: false,
      width: 0, height: 0
    };
    sphereRef.current = state;

    const resize = () => {
      state.width = window.innerWidth;
      state.height = window.innerHeight;
      canvas.width = Math.floor(state.width * dpr);
      canvas.height = Math.floor(state.height * dpr);
      canvas.style.width = `${state.width}px`;
      canvas.style.height = `${state.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    let raf = 0;
    let lastT = 0;
    let alive = true;
    const draw = (t: number) => {
      if (!alive) return;
      // Frame-pace gate: cap at ~60fps so 120Hz+ displays don't burn 2× the
      // CPU for no visual gain.
      if (lastT && t - lastT < 14) {
        raf = requestAnimationFrame(draw);
        return;
      }
      lastT = t;

      ctx.clearRect(0, 0, state.width, state.height);
      if (!state.isExtracting) state.rotation += state.baseSpeed;
      state.baseSpeed += (SPHERE_CONFIG.baseSpeed - state.baseSpeed) * 0.06;

      // Compute trig ONCE per frame, not per particle.
      const cos = Math.cos(state.rotation);
      const sin = Math.sin(state.rotation);
      const cx = state.width / 2;
      const cy = state.height / 2;
      const R = SPHERE_CONFIG.radius;
      const persp = SPHERE_CONFIG.perspective;

      const particles = state.particles;
      const len = particles.length;

      if (!state.isExtracting) {
        // Hot loop. Single state ctx, drawImage with simple scaling.
        for (let i = 0; i < len; i++) {
          const p = particles[i];
          const x1 = p.ox * cos - p.oz * sin;
          const z1 = p.oz * cos + p.ox * sin;
          const y1 = p.oy;
          const scale = persp / (persp + z1);
          if (scale <= 0) continue;
          let alpha = (z1 + R) / (2 * R);
          if (alpha < 0.1) alpha = 0.1; else if (alpha > 1) alpha = 1;
          if (alpha < 0.12) continue; // skip almost-invisible
          p.current2DX = x1 * scale;
          p.current2DY = y1 * scale;
          const g = atlas.get(p.value);
          if (!g) continue;
          const size = GLYPH_BASE * scale * 0.5; // 0.5: drawn glyph fits 14px logical
          const half = size / 2;
          ctx.globalAlpha = alpha;
          ctx.drawImage(g, cx + p.current2DX - half, cy + p.current2DY - half, size, size);
        }
      } else {
        // Extraction phase: chosen particles fly to inputs (with green glow),
        // others drift outward and fade. Lighter loop because shadowBlur is
        // applied only to chosen ones.
        for (let i = 0; i < len; i++) {
          const p = particles[i];
          if (p.isChosen) {
            p.current2DX += (p.targetX - p.current2DX) * SPHERE_CONFIG.extractEase;
            p.current2DY += (p.targetY - p.current2DY) * SPHERE_CONFIG.extractEase;
            p.scale += (2.6 - p.scale) * 0.05;
            const g = greenAtlas.get(p.value);
            if (!g) continue;
            const size = GLYPH_BASE * p.scale * 0.5;
            const half = size / 2;
            ctx.globalAlpha = 1;
            ctx.shadowBlur = 18;
            ctx.shadowColor = 'rgba(46, 213, 115, 0.8)';
            ctx.drawImage(g, cx + p.current2DX - half, cy + p.current2DY - half, size, size);
            ctx.shadowBlur = 0;
          } else {
            p.ox *= 1.04; p.oy *= 1.04; p.oz *= 1.04;
            p.alpha *= 0.92;
            if (p.alpha <= 0.04) continue;
            const x1 = p.ox * cos - p.oz * sin;
            const z1 = p.oz * cos + p.ox * sin;
            const scale = persp / (persp + z1);
            if (scale <= 0) continue;
            const g = atlas.get(p.value);
            if (!g) continue;
            const size = GLYPH_BASE * scale * 0.5;
            const half = size / 2;
            ctx.globalAlpha = p.alpha;
            ctx.drawImage(g, cx + x1 * scale - half, cy + p.oy * scale - half, size, size);
          }
        }
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    // Pause animation while tab is hidden — saves battery / wakelocks.
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        lastT = 0;
      } else {
        raf = requestAnimationFrame(draw);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
      sphereRef.current = null;
    };
  }, []);

  // ---- Auto-submit when all digits filled ----
  useEffect(() => {
    if (busy || success) return;
    if (digits.every(d => d !== '')) {
      void submit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [digits.join('')]);

  // ---- Focus first input on mount / on stage change ----
  useEffect(() => {
    inputsRef.current[0]?.focus();
  }, [setupStage, isSetup]);

  const bumpRotation = () => {
    if (!sphereRef.current) return;
    sphereRef.current.baseSpeed = SPHERE_CONFIG.burstSpeed;
  };

  const onDigitChange = (i: number, raw: string) => {
    const digit = raw.replace(/\D/g, '').slice(-1);
    if (busy || success) return;
    setErr(null);
    setErrored(false);
    setDigits(prev => {
      const next = [...prev];
      next[i] = digit;
      return next;
    });
    if (digit) {
      bumpRotation();
      if (i < PIN_LENGTH - 1) inputsRef.current[i + 1]?.focus();
    }
  };

  const onDigitKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!digits[i] && i > 0) {
        e.preventDefault();
        setDigits(prev => {
          const n = [...prev];
          n[i - 1] = '';
          return n;
        });
        inputsRef.current[i - 1]?.focus();
      }
    } else if (e.key === 'ArrowLeft' && i > 0) {
      inputsRef.current[i - 1]?.focus();
    } else if (e.key === 'ArrowRight' && i < PIN_LENGTH - 1) {
      inputsRef.current[i + 1]?.focus();
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, PIN_LENGTH);
    if (!text) return;
    e.preventDefault();
    setDigits(prev => {
      const next = [...prev];
      for (let i = 0; i < PIN_LENGTH; i++) next[i] = text[i] ?? '';
      return next;
    });
    const focusIdx = Math.min(text.length, PIN_LENGTH - 1);
    inputsRef.current[focusIdx]?.focus();
    bumpRotation();
  };

  const reset = () => {
    setDigits(Array(PIN_LENGTH).fill(''));
    inputsRef.current[0]?.focus();
  };

  const flashError = (msg: string) => {
    setErr(msg);
    setErrored(true);
    setTimeout(() => {
      setErrored(false);
      reset();
    }, 600);
  };

  const triggerExtract = (pin: string) => {
    setSuccess(true);
    const sphere = sphereRef.current;
    if (!sphere) return;
    sphere.isExtracting = true;
    const cx = sphere.width / 2;
    const cy = sphere.height / 2;
    // For each digit in PIN, choose one matching unclaimed particle and aim it
    // at the corresponding input box (slightly above center for visual lift).
    pin.split('').forEach((digit, idx) => {
      const candidate = sphere.particles.find(p => p.value === digit && !p.isChosen);
      if (!candidate) return;
      candidate.isChosen = true;
      const el = inputsRef.current[idx];
      if (!el) return;
      const rect = el.getBoundingClientRect();
      candidate.targetX = rect.left + rect.width / 2 - cx;
      candidate.targetY = rect.top + rect.height / 2 - cy;
    });
  };

  const submit = async () => {
    const pin = digits.join('');
    if (pin.length !== PIN_LENGTH) return;
    setBusy(true);
    setErr(null);
    try {
      if (isSetup) {
        if (setupStage === 'set') {
          setFirstPin(pin);
          setSetupStage('confirm');
          setDigits(Array(PIN_LENGTH).fill(''));
          setBusy(false);
          // small bump for visual feedback
          bumpRotation();
          return;
        }
        if (pin !== firstPin) {
          flashError('两次输入的 PIN 不一致');
          setSetupStage('set');
          setFirstPin('');
          setBusy(false);
          return;
        }
        await api.authSetup(pin);
      } else {
        await api.authLogin(pin);
      }
      triggerExtract(pin);
      setTimeout(() => setPhase('authenticated'), 1500);
    } catch (e) {
      flashError((e as Error).message || '登录失败');
    } finally {
      setBusy(false);
    }
  };

  const heading =
    isSetup && setupStage === 'set'  ? '设置 PIN' :
    isSetup && setupStage === 'confirm' ? '再输一次确认' :
    '请输入 PIN';
  const subtitle =
    isSetup && setupStage === 'set'  ? '首次访问，设置一个 6 位访问 PIN 来保护你的音乐库。' :
    isSetup && setupStage === 'confirm' ? '请再次输入相同的 PIN。' :
    '在混沌中找出隐藏的数字。';

  return (
    <div className="absolute inset-0 overflow-hidden" style={{ background: '#07070b' }}>
      <canvas ref={canvasRef} className="fixed inset-0 z-0 pointer-events-none" />

      {/* subtle ambient gradient */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'radial-gradient(circle at 30% 30%, rgba(199,168,255,0.10), transparent 55%), radial-gradient(circle at 70% 70%, rgba(255,142,199,0.08), transparent 55%)',
          zIndex: 1
        }}
      />

      <div className="relative z-10 h-full w-full flex flex-col items-center justify-center select-none">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-10"
        >
          <div className="flex items-center justify-center gap-2.5 mb-5">
            <motion.div
              className="w-7 h-7 rounded-full"
              style={{
                background: 'conic-gradient(from 90deg, #c7a8ff, #ff8ec7, #ffd596, #c7a8ff)',
                boxShadow: '0 0 18px rgba(199, 168, 255, 0.45)'
              }}
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 14, ease: 'linear' }}
            />
            <div className="text-[15px] font-semibold tracking-[0.18em]" style={{ color: 'rgba(255,255,255,0.85)' }}>LUMEN</div>
          </div>
          <AnimatePresence mode="wait">
            <motion.h1
              key={heading}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
              className="text-[26px] font-semibold tracking-[0.06em]"
            >
              {heading}
            </motion.h1>
          </AnimatePresence>
          <p className="text-[13px] mt-2 max-w-md mx-auto" style={{ color: 'rgba(255,255,255,0.55)' }}>{subtitle}</p>
        </motion.div>

        <div
          ref={groupRef}
          className={`otp-group relative flex gap-3 ${errored ? 'error' : ''} ${success ? 'success' : ''} ${success ? 'otp-locked' : ''}`}
        >
          {digits.map((d, i) => (
            <input
              key={i}
              ref={el => { inputsRef.current[i] = el; }}
              type="tel"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={1}
              className="otp-input"
              value={d}
              onChange={e => onDigitChange(i, e.target.value)}
              onKeyDown={e => onDigitKeyDown(i, e)}
              onPaste={onPaste}
              disabled={busy || success}
            />
          ))}
        </div>

        <div className="mt-5 h-5 text-[12px]" style={{ color: '#ff4757' }}>
          {err && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>{err}</motion.div>}
        </div>

        <AnimatePresence>
          {success && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5, delay: 0.6 }}
              className="mt-8 flex flex-col items-center gap-2"
            >
              <svg className="checkmark-svg draw" viewBox="0 0 52 52">
                <circle className="checkmark-circle" cx="26" cy="26" r="25" />
                <path className="checkmark-path" d="M14.1 27.2l7.1 7.2 16.7-16.8" />
              </svg>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.9, duration: 0.3 }}
                className="text-[13px] font-semibold tracking-[0.18em]"
                style={{ color: '#2ed573' }}
              >
                VERIFIED
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-10 text-[11px]" style={{ color: 'rgba(255,255,255,0.35)' }}>
          scrypt 哈希 · httpOnly cookie 会话 · 阶梯式登录节流
        </div>
      </div>
    </div>
  );
}
