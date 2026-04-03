function createVisualizer(canvasId, isNoisy = false) {
    function isMobileDevice() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
            || (navigator.maxTouchPoints !== undefined && navigator.maxTouchPoints > 0)
            || window.matchMedia('(max-width: 768px)').matches;
    }

    const canvas = document.getElementById(canvasId);
    if (!canvas) {
        console.error(`Canvas with id ${canvasId} not found.`);
        return { start: () => {}, stop: () => {}, setFrequency: () => {} };
    }
    const ctx = canvas.getContext('2d');
    let animationFrameId;
    let audioFrequency = 440;
    let time = 0;
    let noiseDrift = 0;
    let lowPowerMode = false;
    let lastFrameAt = 0;
    let isMobile = isMobileDevice();
    let cachedGradientBg = null;
    let cachedGradientWave = null;

    function resizeCanvas() {
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;
        lowPowerMode = isMobile || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        cachedGradientBg = null;
        cachedGradientWave = null;
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    function draw(now = 0) {
        const frameBudget = lowPowerMode ? (1000 / 18) : (1000 / 60);
        if (now - lastFrameAt < frameBudget) {
            animationFrameId = requestAnimationFrame(draw);
            return;
        }
        lastFrameAt = now;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const width = canvas.width;
        const height = canvas.height;
        const midY = height / 2;
        const normalized = (audioFrequency - 100) / 900;
        const freqFactor = 1.8 + normalized * 8.5;
        const baseAmplitude = (height * 0.14) + normalized * (height * 0.2);

        if (!cachedGradientBg) {
            cachedGradientBg = ctx.createLinearGradient(0, 0, 0, height);
            cachedGradientBg.addColorStop(0, lowPowerMode ? 'rgba(4, 17, 14, 0.2)' : 'rgba(4, 17, 14, 0.25)');
            cachedGradientBg.addColorStop(1, lowPowerMode ? 'rgba(1, 4, 10, 0.46)' : 'rgba(1, 4, 10, 0.55)');
        }
        ctx.fillStyle = cachedGradientBg;
        ctx.fillRect(0, 0, width, height);

        if (!lowPowerMode) {
            ctx.strokeStyle = 'rgba(248, 255, 196, 0.1)';
            ctx.lineWidth = 1;
            const gridStep = Math.max(24, Math.floor(width / 14));
            for (let gx = 0; gx <= width; gx += gridStep) {
                ctx.beginPath();
                ctx.moveTo(gx, 0);
                ctx.lineTo(gx, height);
                ctx.stroke();
            }

            for (let gy = 0; gy <= height; gy += 26) {
                ctx.beginPath();
                ctx.moveTo(0, gy);
                ctx.lineTo(width, gy);
                ctx.stroke();
            }
        }

        const layers = lowPowerMode ? [
            { width: 3, alpha: 0.38, shift: 0.08, colorA: '#31f3ff', colorB: '#ffe260' },
            { width: 1.5, alpha: 0.9, shift: 0, colorA: '#a5fff0', colorB: '#ffda6a' }
        ] : [
            { width: 8, alpha: 0.14, shift: 0.24, colorA: '#00ffd0', colorB: '#f8ff6f' },
            { width: 4, alpha: 0.36, shift: 0.12, colorA: '#31f3ff', colorB: '#ffe260' },
            { width: 2, alpha: 1, shift: 0, colorA: '#a5fff0', colorB: '#ffda6a' }
        ];

        layers.forEach((layer) => {
            const gradient = ctx.createLinearGradient(0, 0, width, 0);
            gradient.addColorStop(0, layer.colorA);
            gradient.addColorStop(0.5, layer.colorB);
            gradient.addColorStop(1, layer.colorA);

            ctx.beginPath();
            const sampleStep = lowPowerMode ? 3 : 1;
            for (let x = 0; x <= width; x += sampleStep) {
                const t = x / width;
                const wobble = Math.sin((x * 0.02) + time * 2 + layer.shift * 8) * (baseAmplitude * 0.08);
                const harmonic = Math.sin((t * Math.PI * 2 * freqFactor) + time + layer.shift * 4) * baseAmplitude;
                const overtone = Math.sin((t * Math.PI * 2 * (freqFactor * 0.5)) - time * 1.4) * (baseAmplitude * 0.33);

                let noise = 0;
                if (isNoisy) {
                    const pseudo = Math.sin((x * 0.12) + noiseDrift + layer.shift * 20);
                    noise = pseudo * (baseAmplitude * 0.15);
                }

                const y = midY + harmonic + overtone + wobble + noise;
                if (x === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }

            ctx.lineWidth = layer.width;
            ctx.globalAlpha = layer.alpha;
            ctx.strokeStyle = gradient;
            ctx.shadowBlur = lowPowerMode ? 0 : 14;
            ctx.shadowColor = '#41ffd0';
            ctx.stroke();
        });

        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;

        time += lowPowerMode ? 0.02 : 0.028;
            time += lowPowerMode ? 0.02 : 0.028;
        noiseDrift += lowPowerMode ? 0.03 : 0.05;
        animationFrameId = requestAnimationFrame(draw);
    }

    return {
        start: (freq) => {
            audioFrequency = freq;
            if (!animationFrameId) {
                resizeCanvas();
                draw();
            }
        },
        stop: () => {
            if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
                animationFrameId = null;
                setTimeout(() => ctx.clearRect(0, 0, canvas.width, canvas.height), 50);
            }
        },
        setFrequency: (freq) => {
            audioFrequency = freq;
        }
    };
}

const listenVisualizer = createVisualizer('visualizer-canvas-listen', false); // Clean wave
const guessVisualizer = createVisualizer('visualizer-canvas-guess', true); // Noisy wave
