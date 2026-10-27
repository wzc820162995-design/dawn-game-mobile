(() => {
  "use strict";

  const { GameCore, TAU, clamp, distance } = window.NightSurvivors;
  const UI_FONT = '"PingFang SC","Microsoft YaHei","Noto Sans SC",Arial,sans-serif';
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: false });
  const loading = document.getElementById("loading");
  const errorPanel = document.getElementById("error-panel");
  const errorMessage = document.getElementById("error-message");

  const COLORS = {
    ink: "#eef4ff",
    muted: "#97a5c2",
    faint: "#5b6887",
    cyan: "#51d1ff",
    blue: "#4b97ff",
    red: "#ff5374",
    pink: "#ff60b1",
    gold: "#ffca5e",
    green: "#5ce29d",
    violet: "#cb8cff",
  };

  function setFont(size, weight = 700) {
    ctx.font = `${weight} ${size}px ${UI_FONT}`;
  }

  function text(value, x, y, size, color, align = "left", baseline = "top", weight = 700) {
    setFont(size, weight);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(value, x, y);
  }

  function textWidth(value, size, weight = 700) {
    setFont(size, weight);
    return ctx.measureText(value).width;
  }

  function roundedPath(x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function panel(x, y, width, height, fill, stroke = null, radius = 7) {
    roundedPath(x, y, width, height, radius);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  function wrapLines(value, maxWidth) {
    const paragraphs = String(value).split("\n");
    const lines = [];
    for (const paragraph of paragraphs) {
      const words = paragraph.split(/\s+/).filter(Boolean);
      let current = "";
      for (const word of words) {
        const trial = current ? `${current} ${word}` : word;
        if (ctx.measureText(trial).width <= maxWidth) {
          current = trial;
          continue;
        }
        if (current) lines.push(current);
        if (ctx.measureText(word).width <= maxWidth) {
          current = word;
          continue;
        }
        current = "";
        for (const character of word) {
          const charTrial = current + character;
          if (ctx.measureText(charTrial).width <= maxWidth) current = charTrial;
          else {
            if (current) lines.push(current);
            current = character;
          }
        }
      }
      if (current) lines.push(current);
    }
    return lines.length ? lines : [""];
  }

  function drawParagraph(value, x, y, maxWidth, size, lineHeight, color, align = "center") {
    setFont(size, 700);
    const lines = wrapLines(value, maxWidth);
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = "top";
    for (let index = 0; index < lines.length; index += 1) {
      ctx.fillText(lines[index], x, y + index * lineHeight);
    }
    return y + lines.length * lineHeight;
  }

  function drawBar(x, y, width, height, fraction, fill, background, stroke = null) {
    panel(x, y, width, height, background, stroke, 3);
    const innerWidth = Math.max(0, (width - 4) * clamp(fraction, 0, 1));
    if (innerWidth > 0) {
      panel(x + 2, y + 2, innerWidth, height - 4, fill, null, 2);
      if (height >= 10 && innerWidth > 6) {
        ctx.fillStyle = "rgba(255,255,255,0.24)";
        ctx.fillRect(x + 4, y + 3, Math.max(0, innerWidth - 4), 2);
      }
    }
  }

  function ellipse(x, y, rx, ry, fill) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function loadImage(path) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Could not load ${path}`));
      image.src = path;
    });
  }

  function makeWhite(image) {
    const surface = document.createElement("canvas");
    surface.width = image.width;
    surface.height = image.height;
    const surfaceContext = surface.getContext("2d");
    surfaceContext.drawImage(image, 0, 0);
    surfaceContext.globalCompositeOperation = "source-in";
    surfaceContext.fillStyle = "#ffffff";
    surfaceContext.fillRect(0, 0, surface.width, surface.height);
    return surface;
  }

  function makeNightFloor(image) {
    const surface = document.createElement("canvas");
    surface.width = image.width;
    surface.height = image.height;
    const surfaceContext = surface.getContext("2d", { willReadFrequently: true });
    surfaceContext.drawImage(image, 0, 0);
    const pixels = surfaceContext.getImageData(0, 0, surface.width, surface.height);
    for (let index = 0; index < pixels.data.length; index += 4) {
      const light = (pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 +
        pixels.data[index + 2] * 0.114) / 255;
      pixels.data[index] = Math.round(light * 62);
      pixels.data[index + 1] = Math.round(light * 82);
      pixels.data[index + 2] = Math.round(light * 132);
    }
    surfaceContext.putImageData(pixels, 0, 0);
    return surface;
  }

  class SoundBank {
    constructor() {
      this.context = null;
      this.buffers = {};
      this.throttles = new Map();
      this.enabled = true;
    }

    async load() {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        this.enabled = false;
        return;
      }
      try {
        this.context = new AudioContextClass();
        const names = ["hit", "gem", "level_up", "hurt", "end"];
        await Promise.all(names.map(async (name) => {
          const response = await fetch(`sounds/${name}.wav`);
          if (!response.ok) throw new Error(`Missing sound: ${name}`);
          const data = await response.arrayBuffer();
          this.buffers[name] = await this.context.decodeAudioData(data);
        }));
      } catch (error) {
        console.warn("Sound disabled", error);
        this.enabled = false;
      }
    }

    async unlock() {
      if (!this.context) return;
      if (this.context.state === "suspended") {
        try {
          await this.context.resume();
        } catch (error) {
          console.warn("Audio unlock failed", error);
        }
      }
    }

    play(name, throttle = 0) {
      if (!this.enabled || !this.context || !this.buffers[name]) return;
      const now = performance.now() / 1000;
      const last = this.throttles.get(name) || 0;
      if (throttle && now - last < throttle) return;
      this.throttles.set(name, now);
      const source = this.context.createBufferSource();
      const gain = this.context.createGain();
      source.buffer = this.buffers[name];
      gain.gain.value = name === "end" ? 0.26 : 0.2;
      source.connect(gain);
      gain.connect(this.context.destination);
      source.start();
    }
  }

  class MobileGame {
    constructor(config, assets, audio) {
      this.config = config;
      this.assets = assets;
      this.audio = audio;
      this.core = new GameCore(config);
      this.width = 390;
      this.height = 844;
      this.dpr = 1;
      this.paused = false;
      this.lastFrame = performance.now();
      this.accumulator = 0;
      this.fixedDt = Number(config.screen.fixed_dt);
      this.joystick = {
        active: false,
        pointerId: null,
        baseX: 0,
        baseY: 0,
        knobX: 0,
        knobY: 0,
        radius: 50,
        direction: { x: 0, y: 0 },
      };
      this.keys = new Set();
      this.effects = [];
      this.particles = [];
      this.pulses = [];
      this.floatingTexts = [];
      this.shakeTime = 0;
      this.shakePower = 0;
      this.shakeX = 0;
      this.shakeY = 0;
      this.hurtFlash = 0;
      this.bossAlert = 0;
      this.cardRects = [];
      this.pauseRect = null;
      this.soundTimers = {};
      this.ready = false;
      this.floorTile = makeNightFloor(assets.floor);
      this.enemyImages = {
        bat: assets.bat,
        slime: assets.slime,
        ghost: assets.ghost,
        demon: assets.demon,
      };
      this.enemyWhite = {};
      for (const [key, image] of Object.entries(this.enemyImages)) {
        this.enemyWhite[key] = makeWhite(image);
      }
      this.heroWhite = makeWhite(assets.hero);
      this.resize();
      this.bindInput();
      this.start();
      this.ready = true;
    }

    resize() {
      const rect = canvas.getBoundingClientRect();
      this.width = Math.max(1, rect.width);
      this.height = Math.max(1, rect.height);
      this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      canvas.width = Math.round(this.width * this.dpr);
      canvas.height = Math.round(this.height * this.dpr);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;
      this.vignette = ctx.createRadialGradient(
        this.width / 2,
        this.height / 2,
        Math.min(this.width, this.height) * 0.16,
        this.width / 2,
        this.height / 2,
        Math.max(this.width, this.height) * 0.66,
      );
      this.vignette.addColorStop(0, "rgba(2,5,14,0)");
      this.vignette.addColorStop(0.65, "rgba(2,5,14,0.12)");
      this.vignette.addColorStop(1, "rgba(2,5,14,0.78)");
    }

    bindInput() {
      canvas.addEventListener("pointerdown", (event) => this.pointerDown(event), { passive: false });
      canvas.addEventListener("pointermove", (event) => this.pointerMove(event), { passive: false });
      canvas.addEventListener("pointerup", (event) => this.pointerUp(event), { passive: false });
      canvas.addEventListener("pointercancel", (event) => this.pointerUp(event), { passive: false });
      canvas.addEventListener("contextmenu", (event) => event.preventDefault());
      window.addEventListener("resize", () => this.resize(), { passive: true });
      window.addEventListener("orientationchange", () => setTimeout(() => this.resize(), 180), { passive: true });
      window.addEventListener("keydown", (event) => this.keyDown(event));
      window.addEventListener("keyup", (event) => this.keyUp(event));
      document.addEventListener("visibilitychange", () => {
        if (document.hidden && this.core.mode === "playing") this.paused = true;
        this.lastFrame = performance.now();
        this.accumulator = 0;
      });
    }

    pointerPosition(event) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    }

    pointerHit(rect, point) {
      return point.x >= rect.x && point.x <= rect.x + rect.w &&
        point.y >= rect.y && point.y <= rect.y + rect.h;
    }

    pointerDown(event) {
      event.preventDefault();
      this.audio.unlock();
      const point = this.pointerPosition(event);

      if (this.core.mode === "level_up") {
        for (const item of this.cardRects) {
          if (this.pointerHit(item.rect, point)) {
            this.core.chooseCard(item.id);
            this.processEvents();
            break;
          }
        }
        return;
      }
      if (this.core.mode === "game_over" || this.core.mode === "victory") {
        this.restart();
        return;
      }
      if (this.paused) {
        this.paused = false;
        this.lastFrame = performance.now();
        this.accumulator = 0;
        return;
      }
      if (this.pauseRect && this.pointerHit(this.pauseRect, point)) {
        this.paused = true;
        return;
      }
      if (this.core.mode === "playing" && point.x < this.width * 0.64 &&
        point.y > this.height * 0.4) {
        this.joystick.active = true;
        this.joystick.pointerId = event.pointerId;
        this.joystick.baseX = point.x;
        this.joystick.baseY = point.y;
        this.joystick.knobX = point.x;
        this.joystick.knobY = point.y;
        this.joystick.direction.x = 0;
        this.joystick.direction.y = 0;
        canvas.setPointerCapture?.(event.pointerId);
      }
    }

    pointerMove(event) {
      if (!this.joystick.active || event.pointerId !== this.joystick.pointerId) return;
      event.preventDefault();
      const point = this.pointerPosition(event);
      let dx = point.x - this.joystick.baseX;
      let dy = point.y - this.joystick.baseY;
      const length = Math.hypot(dx, dy);
      const maxLength = this.joystick.radius;
      if (length > maxLength) {
        dx = dx / length * maxLength;
        dy = dy / length * maxLength;
      }
      this.joystick.knobX = this.joystick.baseX + dx;
      this.joystick.knobY = this.joystick.baseY + dy;
      const amount = clamp(Math.hypot(dx, dy) / maxLength, 0, 1);
      if (amount < 0.12) {
        this.joystick.direction.x = 0;
        this.joystick.direction.y = 0;
      } else {
        const strength = (amount - 0.12) / 0.88;
        this.joystick.direction.x = dx / Math.max(0.001, Math.hypot(dx, dy)) * strength;
        this.joystick.direction.y = dy / Math.max(0.001, Math.hypot(dx, dy)) * strength;
      }
    }

    pointerUp(event) {
      if (event.pointerId !== this.joystick.pointerId) return;
      event.preventDefault();
      this.joystick.active = false;
      this.joystick.pointerId = null;
      this.joystick.direction.x = 0;
      this.joystick.direction.y = 0;
      try {
        canvas.releasePointerCapture(event.pointerId);
      } catch (_) {
        // The browser may have already released capture.
      }
    }

    keyDown(event) {
      const key = event.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d"].includes(key)) {
        event.preventDefault();
        this.keys.add(key);
      } else if (key === "p" || key === "escape") {
        if (this.core.mode === "playing") this.paused = !this.paused;
      }
    }

    keyUp(event) {
      this.keys.delete(event.key.toLowerCase());
    }

    inputDirection() {
      if (this.joystick.active) {
        return { x: this.joystick.direction.x, y: this.joystick.direction.y };
      }
      let x = 0;
      let y = 0;
      if (this.keys.has("arrowright") || this.keys.has("d")) x += 1;
      if (this.keys.has("arrowleft") || this.keys.has("a")) x -= 1;
      if (this.keys.has("arrowdown") || this.keys.has("s")) y += 1;
      if (this.keys.has("arrowup") || this.keys.has("w")) y -= 1;
      const length = Math.hypot(x, y);
      return length ? { x: x / length, y: y / length } : { x: 0, y: 0 };
    }

    restart() {
      this.core.reset();
      this.paused = false;
      this.effects = [];
      this.particles = [];
      this.pulses = [];
      this.floatingTexts = [];
      this.cardRects = [];
      this.shakeTime = 0;
      this.shakePower = 0;
      this.hurtFlash = 0;
      this.bossAlert = 0;
      this.joystick.active = false;
      this.joystick.pointerId = null;
      this.joystick.direction.x = 0;
      this.joystick.direction.y = 0;
      this.accumulator = 0;
    }

    start() {
      this.lastFrame = performance.now();
      requestAnimationFrame((time) => this.loop(time));
    }

    loop(time) {
      const dt = Math.min(0.05, Math.max(0, (time - this.lastFrame) / 1000));
      this.lastFrame = time;
      this.update(dt);
      this.render(time / 1000);
      requestAnimationFrame((nextTime) => this.loop(nextTime));
    }

    update(dt) {
      this.updateEffects(dt);
      if (this.paused || document.hidden) return;
      this.accumulator += dt;
      let steps = 0;
      while (this.accumulator >= this.fixedDt && steps < 5) {
        this.core.update(this.inputDirection(), this.fixedDt);
        this.accumulator -= this.fixedDt;
        steps += 1;
        this.processEvents();
        if (this.core.mode !== "playing") break;
      }
      if (steps === 5) this.accumulator = Math.min(this.accumulator, this.fixedDt);
    }

    updateEffects(dt) {
      this.hurtFlash = Math.max(0, this.hurtFlash - dt);
      this.bossAlert = Math.max(0, this.bossAlert - dt);
      if (this.shakeTime > 0) {
        this.shakeTime -= dt;
        const amount = this.shakePower * clamp(this.shakeTime / 0.24, 0, 1);
        this.shakeX = (Math.random() * 2 - 1) * amount;
        this.shakeY = (Math.random() * 2 - 1) * amount;
      } else {
        this.shakeX = 0;
        this.shakeY = 0;
      }
      for (const item of this.floatingTexts) {
        item.life -= dt;
        item.y -= 30 * dt;
      }
      this.floatingTexts = this.floatingTexts.filter((item) => item.life > 0);
      for (const particle of this.particles) {
        particle.life -= dt;
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        particle.vx *= 0.95;
        particle.vy *= 0.95;
      }
      this.particles = this.particles.filter((particle) => particle.life > 0);
      for (const pulse of this.pulses) pulse.life -= dt;
      this.pulses = this.pulses.filter((pulse) => pulse.life > 0);
    }

    processEvents() {
      for (const event of this.core.drainEvents()) {
        if (event.type === "damage") {
          this.floatingTexts.push({
            x: event.x + (Math.random() * 16 - 8),
            y: event.y - 8,
            value: `-${Math.round(event.amount)}`,
            life: 0.58,
            maxLife: 0.58,
            color: event.source === "spark" ? COLORS.cyan : COLORS.gold,
            size: 14,
          });
          this.audio.play("hit", 0.045);
        } else if (event.type === "kill") {
          this.makeBurst(event.x, event.y, event.isBoss);
          if (event.isBoss) this.shake(0.34, 13);
          this.audio.play("hit", 0.07);
        } else if (event.type === "gem") {
          this.floatingTexts.push({
            x: event.x,
            y: event.y - 8,
            value: `+${event.value} XP`,
            life: 0.45,
            maxLife: 0.45,
            color: "#6de1ff",
            size: 12,
          });
          this.audio.play("gem", 0.07);
        } else if (event.type === "hurt") {
          this.hurtFlash = 0.24;
          this.shake(0.24, 8);
          this.audio.play("hurt", 0.16);
        } else if (event.type === "level_up") {
          this.joystick.active = false;
          this.joystick.direction.x = 0;
          this.joystick.direction.y = 0;
          this.audio.play("level_up");
        } else if (event.type === "upgrade") {
          this.audio.play("gem");
        } else if (event.type === "boss_spawn") {
          this.bossAlert = 2.7;
          this.shake(0.5, 5);
          this.audio.play("level_up");
        } else if (event.type === "holy_pulse") {
          this.pulses.push({
            x: event.x,
            y: event.y,
            radius: event.radius,
            life: 0.32,
            maxLife: 0.32,
          });
        } else if (event.type === "game_over" || event.type === "victory") {
          this.audio.play("end");
        }
      }
    }

    makeBurst(x, y, boss) {
      const count = boss ? 24 : 7;
      for (let index = 0; index < count; index += 1) {
        const angle = Math.random() * TAU;
        const speed = (36 + Math.random() * 105) * (boss ? 1.4 : 1);
        this.particles.push({
          x,
          y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 0.22 + Math.random() * 0.28,
          color: [COLORS.cyan, "#ffffff", COLORS.gold, COLORS.pink][Math.floor(Math.random() * 4)],
          size: 2 + Math.floor(Math.random() * 3),
        });
      }
    }

    shake(seconds, power) {
      this.shakeTime = seconds;
      this.shakePower = power;
    }

    camera() {
      return {
        x: this.core.heroX - this.width / 2 + this.shakeX,
        y: this.core.heroY - this.height / 2 + this.shakeY,
      };
    }

    worldToScreen(x, y, camera = this.camera()) {
      return { x: x - camera.x, y: y - camera.y };
    }

    render(time) {
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.width, this.height);
      ctx.fillStyle = "#080b19";
      ctx.fillRect(0, 0, this.width, this.height);
      this.drawWorld(time);
      ctx.fillStyle = this.vignette;
      ctx.fillRect(0, 0, this.width, this.height);
      this.drawHUD();
      if (this.core.mode === "level_up") this.drawLevelUp();
      else if (this.core.mode === "game_over" || this.core.mode === "victory") this.drawEnd();
      else if (this.paused) this.drawPause();
      else this.drawJoystick();
      if (this.bossAlert > 0 && this.core.boss && this.core.mode === "playing") {
        this.drawBossAlert();
      }
      if (this.hurtFlash > 0) {
        ctx.fillStyle = `rgba(255,38,79,${this.hurtFlash / 0.24 * 0.2})`;
        ctx.fillRect(0, 0, this.width, this.height);
      }
    }

    drawWorld(time) {
      const camera = this.camera();
      this.drawFloor(camera);
      this.drawAmbientMotes(time);
      this.drawHolyRing();
      this.drawPulses(camera);
      this.drawGems(camera, time);
      this.drawProjectiles(camera);
      this.drawEnemies(camera, time);
      this.drawBlades(camera);
      this.drawHero(camera, time);
      this.drawParticles(camera);
      this.drawFloatingTexts(camera);
    }

    drawFloor(camera) {
      const size = this.floorTile.width;
      const startX = Math.floor(camera.x / size) * size;
      const startY = Math.floor(camera.y / size) * size;
      for (let worldX = startX; worldX < camera.x + this.width; worldX += size) {
        for (let worldY = startY; worldY < camera.y + this.height; worldY += size) {
          ctx.drawImage(this.floorTile, Math.round(worldX - camera.x), Math.round(worldY - camera.y), size, size);
        }
      }
      ctx.fillStyle = "rgba(11,17,43,0.17)";
      ctx.fillRect(0, 0, this.width, this.height);
    }

    drawAmbientMotes(time) {
      const camera = this.camera();
      for (let index = 0; index < 28; index += 1) {
        const x = ((index * 83 + 41 - camera.x * 0.04) % this.width + this.width) % this.width;
        const y = ((index * 137 + 67 - camera.y * 0.03) % this.height + this.height) % this.height;
        const pulse = 0.35 + 0.65 * ((Math.sin(time * 1.7 + index) + 1) / 2);
        ctx.fillStyle = `rgba(71,118,168,${0.1 + pulse * 0.22})`;
        ctx.fillRect(Math.round(x), Math.round(y), 1.5, 1.5);
      }
    }

    drawHolyRing() {
      const level = this.core.weaponLevels.holy || 0;
      if (!level) return;
      const cfg = this.config.weapons.holy;
      const radius = Number(cfg.radius) + Number(cfg.radius_per_level) * (level - 1);
      const center = this.worldToScreen(this.core.heroX, this.core.heroY);
      ctx.beginPath();
      ctx.arc(center.x, center.y, radius, 0, TAU);
      ctx.fillStyle = "rgba(203,140,255,0.045)";
      ctx.fill();
      ctx.strokeStyle = "rgba(203,140,255,0.35)";
      ctx.lineWidth = 2;
      ctx.stroke();
      for (let index = 0; index < 12; index += 1) {
        const angle = this.core.time * 0.55 + index * TAU / 12;
        ctx.beginPath();
        ctx.moveTo(center.x + Math.cos(angle) * (radius - 4), center.y + Math.sin(angle) * (radius - 4));
        ctx.lineTo(center.x + Math.cos(angle) * (radius + 3), center.y + Math.sin(angle) * (radius + 3));
        ctx.strokeStyle = "rgba(220,172,255,0.7)";
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    drawPulses(camera) {
      for (const pulse of this.pulses) {
        const point = this.worldToScreen(pulse.x, pulse.y, camera);
        const progress = 1 - pulse.life / pulse.maxLife;
        ctx.beginPath();
        ctx.arc(point.x, point.y, pulse.radius * (0.72 + progress * 0.34), 0, TAU);
        ctx.strokeStyle = `rgba(203,140,255,${0.55 * (1 - progress)})`;
        ctx.lineWidth = 3 * (1 - progress) + 1;
        ctx.stroke();
      }
    }

    drawGems(camera, time) {
      for (const gem of this.core.gems) {
        const point = this.worldToScreen(gem.x, gem.y, camera);
        const pulse = 0.5 + 0.5 * Math.sin(time * 5 + gem.id);
        ctx.beginPath();
        ctx.arc(point.x, point.y, 13 + pulse * 5, 0, TAU);
        ctx.fillStyle = gem.value === 1 ? "rgba(70,190,255,0.11)" : "rgba(255,78,176,0.12)";
        ctx.fill();
        const image = gem.value === 1 ? this.assets.gem_blue : this.assets.gem_pink;
        const size = gem.value === 1 ? 28 : 32;
        const bob = Math.sin(time * 5 + gem.id * 1.7) * 2;
        ctx.drawImage(image, point.x - size / 2, point.y - size / 2 + bob, size, size);
      }
    }

    drawProjectiles(camera) {
      for (const projectile of this.core.projectiles) {
        const point = this.worldToScreen(projectile.x, projectile.y, camera);
        const length = Math.hypot(projectile.vx, projectile.vy) || 1;
        const tx = point.x - projectile.vx / length * 22;
        const ty = point.y - projectile.vy / length * 22;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(point.x, point.y);
        ctx.strokeStyle = "#2e73e6";
        ctx.lineWidth = 7;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(point.x, point.y);
        ctx.strokeStyle = "#61d4ff";
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4, 0, TAU);
        ctx.fillStyle = "#e6fbff";
        ctx.fill();
      }
    }

    drawEnemies(camera, time) {
      const sizes = { bat: 42, slime: 46, ghost: 44, demon: 96 };
      for (const enemy of this.core.enemies) {
        if (enemy.dead) continue;
        const point = this.worldToScreen(enemy.x, enemy.y, camera);
        const size = sizes[enemy.kind];
        const bob = Math.sin(time * 4.2 + enemy.id * 0.8) * (enemy.isBoss ? 3 : 1.5);
        ellipse(point.x, point.y + size * 0.36, size * 0.32, 5, "rgba(2,5,13,0.52)");
        const image = this.core.time < enemy.flashUntil ?
          this.enemyWhite[enemy.kind] : this.enemyImages[enemy.kind];
        ctx.save();
        ctx.translate(point.x, point.y + bob);
        if (enemy.x > this.core.heroX) ctx.scale(-1, 1);
        ctx.drawImage(image, -size / 2, -size / 2, size, size);
        ctx.restore();
        if (!enemy.isBoss && enemy.hp < enemy.maxHp) {
          drawBar(point.x - 17, point.y + size * 0.42, 34, 4, enemy.hp / enemy.maxHp,
            COLORS.red, "rgba(35,31,49,0.9)");
        }
      }
    }

    drawBlades(camera) {
      const level = this.core.weaponLevels.blades || 0;
      if (!level) return;
      const cfg = this.config.weapons.blades;
      let count = Number(cfg.blades);
      for (const [levelReq, value] of Object.entries(cfg.blades_at_levels)) {
        if (level >= Number(levelReq)) count = Number(value);
      }
      const center = this.worldToScreen(this.core.heroX, this.core.heroY, camera);
      for (let index = 0; index < count; index += 1) {
        const angle = this.core.bladeAngle + TAU * index / count;
        const x = center.x + Math.cos(angle) * Number(cfg.orbit_radius);
        const y = center.y + Math.sin(angle) * Number(cfg.orbit_radius);
        const tx = center.x + Math.cos(angle - 0.2) * Number(cfg.orbit_radius);
        const ty = center.y + Math.sin(angle - 0.2) * Number(cfg.orbit_radius);
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.lineTo(x, y);
        ctx.strokeStyle = "rgba(255,190,75,0.72)";
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle + Math.PI / 2);
        ctx.drawImage(this.assets.sword, -21, -21, 42, 42);
        ctx.restore();
      }
    }

    drawHero(camera, time) {
      const point = this.worldToScreen(this.core.heroX, this.core.heroY, camera);
      const bob = this.core.mode === "playing" ? Math.sin(time * 7) * 1.4 : 0;
      ellipse(point.x, point.y + 31, 20, 5, "rgba(2,5,13,0.65)");
      ctx.beginPath();
      ctx.arc(point.x, point.y, 32, 0, TAU);
      ctx.fillStyle = "rgba(74,194,255,0.08)";
      ctx.fill();
      ctx.save();
      ctx.translate(point.x, point.y + bob);
      if (this.core.heroFacing < 0) ctx.scale(-1, 1);
      const image = this.hurtFlash > 0.12 ? this.heroWhite : this.assets.hero;
      ctx.drawImage(image, -25, -25, 50, 50);
      ctx.restore();
    }

    drawParticles(camera) {
      for (const particle of this.particles) {
        const point = this.worldToScreen(particle.x, particle.y, camera);
        ctx.globalAlpha = clamp(particle.life / 0.4, 0, 1);
        ctx.fillStyle = particle.color;
        ctx.fillRect(point.x - particle.size / 2, point.y - particle.size / 2, particle.size, particle.size);
      }
      ctx.globalAlpha = 1;
    }

    drawFloatingTexts(camera) {
      for (const item of this.floatingTexts) {
        const point = this.worldToScreen(item.x, item.y, camera);
        ctx.globalAlpha = clamp(item.life / item.maxLife, 0, 1);
        text(item.value, point.x, point.y, item.size, item.color, "center", "middle");
      }
      ctx.globalAlpha = 1;
    }

    drawHUD() {
      const gradient = ctx.createLinearGradient(0, 0, 0, 104);
      gradient.addColorStop(0, "rgba(7,11,26,0.97)");
      gradient.addColorStop(1, "rgba(7,11,26,0.34)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, this.width, 104);

      text("NIGHT SURVIVORS 夜行者", 16, 10, 11.5, COLORS.ink);
      text(`${this.core.elapsedLabel} / ${this.core.goalLabel}`, this.width - 58, 10, 13,
        "#d6e2f9", "right");

      this.pauseRect = { x: this.width - 44, y: 5, w: 34, h: 30 };
      panel(this.pauseRect.x, this.pauseRect.y, this.pauseRect.w, this.pauseRect.h,
        "rgba(27,42,69,0.9)", "rgba(94,126,175,0.82)", 5);
      ctx.fillStyle = COLORS.ink;
      ctx.fillRect(this.width - 33, 13, 4, 14);
      ctx.fillRect(this.width - 25, 13, 4, 14);

      const levelRect = { x: 16, y: 39, w: 60, h: 22 };
      panel(levelRect.x, levelRect.y, levelRect.w, levelRect.h,
        "rgba(30,42,68,0.96)", "rgba(82,110,157,0.85)", 4);
      text(`LV ${this.core.level}级`, levelRect.x + levelRect.w / 2, levelRect.y + 11, 11,
        COLORS.gold, "center", "middle");

      const hpX = 84;
      const hpWidth = this.width - hpX - 16;
      drawBar(hpX, 40, hpWidth, 18, this.core.hp / this.core.maxHp, COLORS.red,
        "rgba(45,25,44,0.95)", "rgba(91,54,79,0.85)");
      text(`HP 生命 ${Math.ceil(this.core.hp)} / ${Math.ceil(this.core.maxHp)}`,
        hpX + hpWidth / 2, 49, 10.5, "#ffffff", "center", "middle");
      drawBar(16, 64, this.width - 32, 8, this.core.xp / this.core.xpToNext,
        COLORS.blue, "rgba(23,35,61,0.96)");
      text(`XP 经验 ${this.core.xp}/${this.core.xpToNext}`, 16, 77, 10.5, "#7d9dd8");
      text(`${this.core.kills} KILLS 击败`, this.width - 16, 77, 9.5, COLORS.faint, "right");

      const boss = this.core.boss;
      if (boss) {
        text("THE DEMON 恶魔", this.width / 2, 91, 10.5, "#ffaebf", "center");
        drawBar(52, 102, this.width - 104, 9, boss.hp / boss.maxHp, COLORS.red,
          "rgba(46,21,39,0.95)", "rgba(100,45,70,0.85)");
      }

      this.drawLoadout();
    }

    loadoutItems() {
      const weapons = { spark: "Spark 星火", blades: "Blades 旋刃", holy: "Holy 圣环" };
      const passives = { boots: "Boots 疾靴", heart: "Heart 强心", magnet: "Magnet 磁石" };
      const items = [];
      for (const [key, name] of Object.entries(weapons)) {
        if (this.core.weaponLevels[key]) items.push({ key, name, level: this.core.weaponLevels[key] });
      }
      for (const [key, name] of Object.entries(passives)) {
        if (this.core.passiveLevels[key]) items.push({ key, name, level: this.core.passiveLevels[key] });
      }
      return items;
    }

    drawLoadout() {
      const items = this.loadoutItems();
      const height = 58;
      const baseY = this.height - height;
      const gradient = ctx.createLinearGradient(0, baseY, 0, this.height);
      gradient.addColorStop(0, "rgba(7,11,26,0.1)");
      gradient.addColorStop(1, "rgba(7,11,26,0.96)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, baseY, this.width, height);
      if (!items.length) return;
      const rows = items.length <= 3 ? 1 : 2;
      const perRow = rows === 1 ? items.length : 3;
      const gap = 6;
      const margin = 14;
      const chipWidth = Math.min(120, (this.width - margin * 2 - gap * (perRow - 1)) / perRow);
      const startY = rows === 1 ? this.height - 37 : this.height - 51;
      const accents = {
        spark: COLORS.cyan,
        blades: COLORS.gold,
        holy: COLORS.violet,
        boots: COLORS.gold,
        heart: COLORS.pink,
        magnet: COLORS.green,
      };
      for (let row = 0; row < rows; row += 1) {
        const rowItems = items.slice(row * 3, row * 3 + 3);
        const total = chipWidth * rowItems.length + gap * Math.max(0, rowItems.length - 1);
        const startX = (this.width - total) / 2;
        for (let index = 0; index < rowItems.length; index += 1) {
          const item = rowItems[index];
          const x = startX + index * (chipWidth + gap);
          const y = startY + row * 27;
          panel(x, y, chipWidth, 23, "rgba(17,25,46,0.95)", "rgba(43,58,91,0.9)", 5);
          ctx.beginPath();
          ctx.arc(x + 10, y + 11.5, 3.5, 0, TAU);
          ctx.fillStyle = accents[item.key];
          ctx.fill();
          text(`${item.name} ${item.level}`, x + 18, y + 11.5, this.width < 360 ? 9 : 10,
            "#d0ddf3", "left", "middle");
        }
      }
    }

    drawJoystick() {
      if (this.core.mode !== "playing" || this.paused) return;
      const active = this.joystick.active;
      const x = active ? this.joystick.baseX : 76;
      const y = active ? this.joystick.baseY : this.height - 142;
      const radius = this.joystick.radius;
      ctx.beginPath();
      ctx.arc(x, y, radius + 8, 0, TAU);
      ctx.fillStyle = active ? "rgba(17,39,66,0.46)" : "rgba(15,32,55,0.22)";
      ctx.fill();
      ctx.strokeStyle = active ? "rgba(94,209,255,0.54)" : "rgba(92,146,193,0.22)";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.48, 0, TAU);
      ctx.fillStyle = active ? "rgba(92,214,255,0.35)" : "rgba(81,164,211,0.13)";
      ctx.fill();
      ctx.strokeStyle = active ? "rgba(187,239,255,0.75)" : "rgba(120,174,215,0.2)";
      ctx.stroke();
      if (active) {
        ctx.beginPath();
        ctx.moveTo(x, y - radius - 3);
        ctx.lineTo(x, y + radius + 3);
        ctx.moveTo(x - radius - 3, y);
        ctx.lineTo(x + radius + 3, y);
        ctx.strokeStyle = "rgba(99,198,242,0.18)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      const knobX = active ? this.joystick.knobX : x;
      const knobY = active ? this.joystick.knobY : y;
      ctx.beginPath();
      ctx.arc(knobX, knobY, 20, 0, TAU);
      ctx.fillStyle = active ? "rgba(83,205,255,0.55)" : "rgba(68,144,190,0.24)";
      ctx.fill();
      ctx.strokeStyle = active ? "rgba(203,249,255,0.9)" : "rgba(105,170,215,0.36)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    drawCardIcon(card, x, y, size) {
      const accent = card.accent;
      ctx.beginPath();
      ctx.arc(x, y, size * 0.63, 0, TAU);
      ctx.fillStyle = `${accent}18`;
      ctx.fill();
      ctx.strokeStyle = `${accent}68`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      if (card.key === "spark") {
        ctx.beginPath();
        ctx.moveTo(x + 3, y - size * 0.45);
        ctx.lineTo(x - size * 0.25, y + 2);
        ctx.lineTo(x + 1, y + 2);
        ctx.lineTo(x - 3, y + size * 0.45);
        ctx.lineTo(x + size * 0.28, y - 2);
        ctx.lineTo(x, y - 2);
        ctx.closePath();
        ctx.fillStyle = "#eafbff";
        ctx.fill();
        ctx.strokeStyle = accent;
        ctx.stroke();
      } else if (card.key === "blades") {
        for (const rotation of [-0.55, 0.55]) {
          ctx.save();
          ctx.translate(x, y);
          ctx.rotate(rotation);
          ctx.drawImage(this.assets.sword, -size * 0.38, -size * 0.52, size * 0.76, size * 1.04);
          ctx.restore();
        }
      } else if (card.key === "holy") {
        ctx.beginPath();
        ctx.arc(x, y, size * 0.45, 0, TAU);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, size * 0.18, 0, TAU);
        ctx.strokeStyle = "#f4e9ff";
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (card.key === "boots") {
        ctx.beginPath();
        ctx.moveTo(x - size * 0.25, y - size * 0.4);
        ctx.lineTo(x + size * 0.02, y - size * 0.34);
        ctx.lineTo(x + size * 0.08, y + 2);
        ctx.lineTo(x + size * 0.4, y + size * 0.12);
        ctx.lineTo(x + size * 0.4, y + size * 0.36);
        ctx.lineTo(x - size * 0.36, y + size * 0.36);
        ctx.closePath();
        ctx.fillStyle = "#ffdc79";
        ctx.fill();
        ctx.strokeStyle = "#8c6124";
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (card.key === "heart") {
        ctx.beginPath();
        ctx.moveTo(x, y + size * 0.38);
        ctx.bezierCurveTo(x - size * 0.5, y + size * 0.02, x - size * 0.4, y - size * 0.42, x, y - size * 0.12);
        ctx.bezierCurveTo(x + size * 0.4, y - size * 0.42, x + size * 0.5, y + size * 0.02, x, y + size * 0.38);
        ctx.fillStyle = "#ff7398";
        ctx.fill();
      } else if (card.key === "magnet") {
        ctx.beginPath();
        ctx.arc(x, y, size * 0.42, Math.PI, TAU);
        ctx.strokeStyle = "#69eed6";
        ctx.lineWidth = 6;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x - size * 0.42, y);
        ctx.lineTo(x - size * 0.42, y + size * 0.34);
        ctx.moveTo(x + size * 0.42, y);
        ctx.lineTo(x + size * 0.42, y + size * 0.34);
        ctx.stroke();
      } else {
        ctx.fillStyle = COLORS.green;
        ctx.fillRect(x - 4, y - size * 0.34, 8, size * 0.68);
        ctx.fillRect(x - size * 0.34, y - 4, size * 0.68, 8);
      }
    }

    drawLevelUp() {
      ctx.fillStyle = "rgba(4,7,18,0.92)";
      ctx.fillRect(0, 0, this.width, this.height);
      const glow = ctx.createRadialGradient(this.width / 2, 80, 10, this.width / 2, 80, 220);
      glow.addColorStop(0, "rgba(48,120,180,0.18)");
      glow.addColorStop(1, "rgba(48,120,180,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, this.width, 300);

      text("LEVEL UP 升级", this.width / 2, 38, this.width < 360 ? 31 : 36,
        "#eef8ff", "center");
      text("Choose one upgrade 选择一项强化", this.width / 2, 82, 13.5, "#8caed2", "center");

      const top = 118;
      const bottomSpace = 54;
      const gap = 10;
      const available = this.height - top - bottomSpace;
      const cardHeight = Math.min(154, (available - gap * 2) / 3);
      this.cardRects = [];
      for (let index = 0; index < this.core.cards.length; index += 1) {
        const card = this.core.cards[index];
        const rect = { x: 14, y: top + index * (cardHeight + gap), w: this.width - 28, h: cardHeight };
        this.cardRects.push({ id: card.id, rect });
        panel(rect.x, rect.y, rect.w, rect.h, "rgba(19,29,52,0.98)",
          `${card.accent}88`, 7);
        ctx.fillStyle = `${card.accent}10`;
        ctx.fillRect(rect.x + 1, rect.y + 1, 4, rect.h - 2);

        const iconSize = Math.min(48, cardHeight * 0.36);
        this.drawCardIcon(card, rect.x + 48, rect.y + cardHeight / 2, iconSize);
        const contentX = rect.x + 92;
        const contentWidth = rect.w - 106;
        text(card.title, contentX, rect.y + 14, 15.5, COLORS.ink);
        text(card.titleZh, contentX, rect.y + 38, 14, "#d7e3f6");
        text(card.description, contentX, rect.y + 65, 10.5, "#8fa3c4");
        text(card.descriptionZh, contentX, rect.y + 84, 12, "#c6d4ea");

        const pillWidth = 78;
        panel(rect.x + rect.w - pillWidth - 10, rect.y + cardHeight - 28, pillWidth, 19,
          `${card.accent}16`, `${card.accent}88`, 4);
        text(`${card.levelLabel} / ${card.levelLabelZh}`,
          rect.x + rect.w - pillWidth / 2 - 10, rect.y + cardHeight - 18.5,
          10, card.accent, "center", "middle");
      }
      text("Tap a card to continue 点击卡牌继续", this.width / 2, this.height - 34,
        11.5, "#5b7194", "center");
    }

    drawPause() {
      ctx.fillStyle = "rgba(4,7,18,0.82)";
      ctx.fillRect(0, 0, this.width, this.height);
      text("PAUSED 已暂停", this.width / 2, this.height / 2 - 60, 39, COLORS.ink, "center");
      text("按 P 或点击继续", this.width / 2, this.height / 2 + 5, 15, "#8ea2c4", "center");
      text("Tap to continue", this.width / 2, this.height / 2 + 30, 12, "#596f92", "center");
    }

    drawEnd() {
      const victory = this.core.mode === "victory";
      ctx.fillStyle = "rgba(4,7,18,0.95)";
      ctx.fillRect(0, 0, this.width, this.height);
      const glow = ctx.createRadialGradient(this.width / 2, this.height * 0.34, 5,
        this.width / 2, this.height * 0.34, this.width * 0.65);
      glow.addColorStop(0, victory ? "rgba(255,193,83,0.14)" : "rgba(255,67,103,0.13)");
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, this.width, this.height);

      text(victory ? "DAWN SURVIVED 熬到黎明" : "THE NIGHT WINS 黑夜降临",
        this.width / 2, this.height * 0.22, 13, victory ? COLORS.gold : COLORS.red, "center");
      text(victory ? "VICTORY" : "GAME OVER", this.width / 2, this.height * 0.26,
        victory ? 43 : 38, COLORS.ink, "center");
      text(victory ? "胜利" : "游戏结束", this.width / 2, this.height * 0.32,
        21, victory ? COLORS.gold : COLORS.red, "center");
      drawParagraph(
        victory ? "You held out until sunrise. 你活到了黎明。" : "The dark was too much. 这次没能撑到黎明。",
        this.width / 2, this.height * 0.38, this.width - 52, 12, 18, "#91a1c0",
      );

      const lineY = this.height * 0.48;
      ctx.strokeStyle = "rgba(53,68,98,0.9)";
      ctx.beginPath();
      ctx.moveTo(36, lineY);
      ctx.lineTo(this.width - 36, lineY);
      ctx.stroke();
      const stats = [
        ["TIME 时间", `${this.core.elapsedLabel} / ${this.core.goalLabel}`],
        ["KILLS 击败", String(this.core.kills)],
        ["LEVEL 等级", String(this.core.level)],
      ];
      for (let index = 0; index < stats.length; index += 1) {
        const x = this.width * (0.23 + index * 0.27);
        text(stats[index][0], x, lineY + 27, 9.5, COLORS.faint, "center");
        text(stats[index][1], x, lineY + 49, 19, COLORS.ink, "center");
      }

      const buttonY = this.height * 0.67;
      panel(54, buttonY, this.width - 108, 50, "rgba(31,43,68,0.98)",
        victory ? COLORS.gold : "rgba(92,119,163,0.95)", 7);
      text("PLAY AGAIN 再来一局", this.width / 2, buttonY + 25, 16, COLORS.ink,
        "center", "middle");
      text("点击任意位置重开 / Tap anywhere", this.width / 2, buttonY + 70,
        10.5, "#66789a", "center");
      text("NIGHT SURVIVORS 夜行者", this.width / 2, this.height - 56,
        10, "#3e4e6c", "center");
    }

    drawBossAlert() {
      const progress = 1 - this.bossAlert / 2.7;
      const alpha = clamp(Math.min(progress * 5, (1 - progress) * 5), 0, 1);
      ctx.fillStyle = `rgba(54,6,24,${0.82 * alpha})`;
      ctx.fillRect(0, 124, this.width, 52);
      ctx.strokeStyle = `rgba(255,80,120,${alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 124);
      ctx.lineTo(this.width, 124);
      ctx.moveTo(0, 176);
      ctx.lineTo(this.width, 176);
      ctx.stroke();
      ctx.globalAlpha = alpha;
      text("THE DEMON AWAKENS 恶魔苏醒", this.width / 2, 150, 16, "#ffe1e8", "center", "middle");
      ctx.globalAlpha = 1;
    }
  }

  async function boot() {
    errorPanel.hidden = true;
    try {
      const response = await fetch("data/game.json", { cache: "no-store" });
      if (!response.ok) throw new Error("Game data could not be loaded.");
      const config = await response.json();
      const paths = {
        hero: "assets/hero.png",
        bat: "assets/bat.png",
        slime: "assets/slime.png",
        ghost: "assets/ghost.png",
        demon: "assets/demon.png",
        floor: "assets/floor.png",
        sword: "assets/sword.png",
        gem_blue: "assets/gem_blue.png",
        gem_pink: "assets/gem_pink.png",
      };
      const entries = await Promise.all(Object.entries(paths).map(async ([key, path]) => {
        return [key, await loadImage(path)];
      }));
      const assets = Object.fromEntries(entries);
      const audio = new SoundBank();
      await audio.load();
      const game = new MobileGame(config, assets, audio);
      window.__nightGame = game;
      loading.classList.add("hidden");
      document.dispatchEvent(new CustomEvent("night-ready"));
    } catch (error) {
      console.error(error);
      loading.classList.add("hidden");
      errorMessage.textContent = String(error.message || error);
      errorPanel.hidden = false;
    }
  }

  document.getElementById("retry-button").addEventListener("click", () => window.location.reload());
  document.addEventListener("DOMContentLoaded", boot, { once: true });
  if (document.readyState !== "loading") boot();
})();
