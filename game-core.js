(() => {
  "use strict";

  const TAU = Math.PI * 2;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const distance = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

  class GameCore {
    constructor(config, rng = Math.random) {
      this.config = config;
      this.rng = rng;
      this.reset();
    }

    reset() {
      const hero = this.config.hero;
      this.time = 0;
      this.mode = "playing";
      this.heroX = 0;
      this.heroY = 0;
      this.heroFacing = 1;
      this.hp = Number(hero.max_hp);
      this.maxHp = Number(hero.max_hp);
      this.level = 1;
      this.xp = 0;
      this.xpToNext = Number(this.config.xp.first_need);
      this.pendingLevels = 0;
      this.cards = [];
      this.kills = 0;
      this.weaponLevels = { spark: 1 };
      this.passiveLevels = {};
      this.enemies = [];
      this.projectiles = [];
      this.gems = [];
      this.events = [];
      this.sparkTimer = 0;
      this.holyTimer = 0;
      this.bladeAngle = -Math.PI / 2;
      this.bladeHitTimes = new Map();
      this.spawnTimer = 0;
      this.bossSpawned = false;
      this.nextEnemyId = 1;
      this.nextProjectileId = 1;
      this.nextGemId = 1;
      this.spawnInitialWave();
    }

    get heroSpeed() {
      const bonus = Number(this.config.passives.boots.speed_percent) *
        (this.passiveLevels.boots || 0);
      return Number(this.config.hero.speed) * (1 + bonus / 100);
    }

    get magnetRadius() {
      return Number(this.config.hero.magnet_radius) +
        Number(this.config.passives.magnet.radius) * (this.passiveLevels.magnet || 0);
    }

    get aliveEnemies() {
      return this.enemies.filter((enemy) => !enemy.dead);
    }

    get boss() {
      return this.enemies.find((enemy) => enemy.isBoss && !enemy.dead) || null;
    }

    get elapsedLabel() {
      const total = Math.min(Math.floor(this.time), Math.floor(this.config.goal_seconds));
      return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
    }

    get goalLabel() {
      const total = Math.floor(this.config.goal_seconds);
      return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
    }

    drainEvents() {
      const events = this.events;
      this.events = [];
      return events;
    }

    currentWave(atTime = this.time) {
      let chosen = this.config.waves[0];
      for (const wave of this.config.waves) {
        if (atTime >= Number(wave.from)) chosen = wave;
        else break;
      }
      return chosen;
    }

    spawnInitialWave() {
      const wave = this.currentWave(0);
      for (let index = 0; index < Number(wave.minimum); index += 1) {
        this.spawnWaveEnemy(wave);
      }
      this.spawnTimer = Number(this.config.spawning.interval);
    }

    update(direction, dt) {
      if (this.mode !== "playing") return;
      this.time += dt;
      if (this.time >= Number(this.config.goal_seconds)) {
        this.time = Number(this.config.goal_seconds);
        this.finish("victory");
        return;
      }

      this.moveHero(direction, dt);
      this.updateBossSpawn();
      this.updateSpawning(dt);
      this.updateWeapons(dt);
      this.updateEnemies(dt);
      this.updateGems(dt);
      this.removeFarEnemies();
      this.removeDeadEnemies();
      this.checkLevelUp();
    }

    moveHero(direction, dt) {
      if (!direction) return;
      const length = Math.hypot(direction.x, direction.y);
      if (length <= 0.001) return;
      const dx = direction.x / length;
      const dy = direction.y / length;
      this.heroX += dx * this.heroSpeed * dt;
      this.heroY += dy * this.heroSpeed * dt;
      if (Math.abs(dx) > 0.05) this.heroFacing = dx >= 0 ? 1 : -1;
    }

    updateSpawning(dt) {
      this.spawnTimer -= dt;
      while (this.spawnTimer <= 0) {
        this.spawnTimer += Number(this.config.spawning.interval);
        this.fillWaveMinimum();
      }
    }

    fillWaveMinimum() {
      const wave = this.currentWave();
      const alive = this.aliveEnemies.length;
      const count = Math.min(
        Math.max(0, Number(wave.minimum) - alive),
        Number(this.config.spawning.max_per_interval),
        Number(this.config.spawning.max_alive) - alive,
      );
      for (let index = 0; index < count; index += 1) this.spawnWaveEnemy(wave);
    }

    spawnWaveEnemy(wave) {
      if (this.aliveEnemies.length >= Number(this.config.spawning.max_alive)) return null;
      const kind = wave.types[Math.floor(this.rng() * wave.types.length)];
      return this.spawnEnemy(kind);
    }

    spawnEnemy(kind, x = null, y = null) {
      const data = this.config.enemies[kind];
      if (x === null || y === null) {
        const angle = this.rng() * TAU;
        const radius = Number(this.config.spawning.radius);
        x = this.heroX + Math.cos(angle) * radius;
        y = this.heroY + Math.sin(angle) * radius;
      }
      const enemy = {
        id: this.nextEnemyId++,
        kind,
        x,
        y,
        hp: Number(data.hp),
        maxHp: Number(data.hp),
        speed: Number(data.speed),
        damage: Number(data.damage),
        xp: Number(data.xp),
        radius: Number(data.radius),
        isBoss: Boolean(data.boss),
        nextDamageAt: 0,
        flashUntil: 0,
        dead: false,
      };
      this.enemies.push(enemy);
      return enemy;
    }

    updateBossSpawn() {
      const spawnAt = Number(this.config.boss.spawn_at);
      if (this.bossSpawned || this.time < spawnAt) return;
      this.bossSpawned = true;
      if (this.aliveEnemies.length >= Number(this.config.spawning.max_alive)) return;
      const boss = this.spawnEnemy(this.config.boss.type);
      this.events.push({ type: "boss_spawn", x: boss.x, y: boss.y });
    }

    updateWeapons(dt) {
      this.updateSpark(dt);
      this.updateProjectiles(dt);
      this.updateBlades(dt);
      this.updateHolyRing(dt);
    }

    updateSpark(dt) {
      this.sparkTimer -= dt;
      if (this.sparkTimer > 0) return;
      const level = this.weaponLevels.spark || 0;
      if (level <= 0) return;
      const target = this.nearestEnemy();
      if (!target) {
        this.sparkTimer = 0;
        return;
      }
      const cfg = this.config.weapons.spark;
      let count = Number(cfg.projectiles);
      for (const [levelReq, value] of Object.entries(cfg.projectiles_at_levels)) {
        if (level >= Number(levelReq)) count = Number(value);
      }
      const baseAngle = Math.atan2(target.y - this.heroY, target.x - this.heroX);
      const spread = Number(cfg.spread);
      const totalArc = spread * (count - 1);
      const damage = Number(cfg.damage) + Number(cfg.damage_per_level) * (level - 1);
      for (let index = 0; index < count; index += 1) {
        const angle = baseAngle - totalArc / 2 + spread * index;
        const speed = Number(cfg.projectile_speed);
        this.projectiles.push({
          id: this.nextProjectileId++,
          x: this.heroX,
          y: this.heroY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          damage,
          radius: Number(cfg.projectile_radius),
          life: Number(cfg.projectile_lifetime),
        });
      }
      const interval = Number(cfg.cooldown) - Number(cfg.cooldown_per_level) * (level - 1);
      this.sparkTimer = Math.max(0.2, interval);
    }

    updateProjectiles(dt) {
      const survivors = [];
      for (const projectile of this.projectiles) {
        projectile.x += projectile.vx * dt;
        projectile.y += projectile.vy * dt;
        projectile.life -= dt;
        let hit = null;
        for (const enemy of this.enemies) {
          if (enemy.dead) continue;
          if (distance(projectile.x, projectile.y, enemy.x, enemy.y) <=
            projectile.radius + enemy.radius) {
            hit = enemy;
            break;
          }
        }
        if (hit) this.damageEnemy(hit, projectile.damage, "spark");
        else if (projectile.life > 0) survivors.push(projectile);
      }
      this.projectiles = survivors;
    }

    updateBlades(dt) {
      const level = this.weaponLevels.blades || 0;
      if (level <= 0) return;
      const cfg = this.config.weapons.blades;
      let count = Number(cfg.blades);
      for (const [levelReq, value] of Object.entries(cfg.blades_at_levels)) {
        if (level >= Number(levelReq)) count = Number(value);
      }
      this.bladeAngle = (this.bladeAngle + TAU / Number(cfg.turn_seconds) * dt) % TAU;
      const damage = Number(cfg.damage) + Number(cfg.damage_per_level) * (level - 1);
      for (const enemy of this.enemies) {
        if (enemy.dead) continue;
        for (let index = 0; index < count; index += 1) {
          const angle = this.bladeAngle + TAU * index / count;
          const bx = this.heroX + Math.cos(angle) * Number(cfg.orbit_radius);
          const by = this.heroY + Math.sin(angle) * Number(cfg.orbit_radius);
          if (distance(bx, by, enemy.x, enemy.y) > Number(cfg.hit_radius) + enemy.radius) {
            continue;
          }
          const key = `${enemy.id}:${index}`;
          const last = this.bladeHitTimes.get(key) ?? -Infinity;
          if (this.time - last < Number(cfg.hit_cooldown)) continue;
          this.bladeHitTimes.set(key, this.time);
          this.damageEnemy(enemy, damage, "blades");
        }
      }
    }

    updateHolyRing(dt) {
      this.holyTimer -= dt;
      const level = this.weaponLevels.holy || 0;
      if (level <= 0 || this.holyTimer > 0) return;
      const cfg = this.config.weapons.holy;
      const radius = Number(cfg.radius) + Number(cfg.radius_per_level) * (level - 1);
      const damage = Number(cfg.damage) + Number(cfg.damage_per_level) * (level - 1);
      for (const enemy of this.enemies) {
        if (enemy.dead) continue;
        if (distance(this.heroX, this.heroY, enemy.x, enemy.y) <= radius) {
          this.damageEnemy(enemy, damage, "holy");
        }
      }
      this.holyTimer = Number(cfg.cooldown);
      this.events.push({ type: "holy_pulse", x: this.heroX, y: this.heroY, radius });
    }

    updateEnemies(dt) {
      for (const enemy of this.enemies) {
        if (enemy.dead) continue;
        if (enemy.isBoss &&
          distance(this.heroX, this.heroY, enemy.x, enemy.y) >
          Number(this.config.boss.relocate_distance)) {
          this.relocateEnemy(enemy);
        }
        const dx = this.heroX - enemy.x;
        const dy = this.heroY - enemy.y;
        const length = Math.hypot(dx, dy);
        if (length > 0.001) {
          const step = Math.min(length, enemy.speed * dt);
          enemy.x += dx / length * step;
          enemy.y += dy / length * step;
        }
        const contactDistance = distance(this.heroX, this.heroY, enemy.x, enemy.y);
        if (contactDistance <= Number(this.config.hero.hit_radius) + enemy.radius &&
          this.time >= enemy.nextDamageAt) {
          this.hurtHero(enemy.damage);
          enemy.nextDamageAt = this.time + Number(this.config.hero.contact_cooldown);
          if (this.mode !== "playing") return;
        }
      }
    }

    relocateEnemy(enemy) {
      const angle = this.rng() * TAU;
      const radius = Number(this.config.spawning.radius);
      enemy.x = this.heroX + Math.cos(angle) * radius;
      enemy.y = this.heroY + Math.sin(angle) * radius;
    }

    hurtHero(amount) {
      this.hp = Math.max(0, this.hp - amount);
      this.events.push({ type: "hurt", amount, x: this.heroX, y: this.heroY });
      if (this.hp <= 0) this.finish("game_over");
    }

    updateGems(dt) {
      const pickupRadius = Number(this.config.hero.pickup_radius);
      const speed = Number(this.config.gems.magnet_speed);
      const survivors = [];
      for (const gem of this.gems) {
        let length = distance(this.heroX, this.heroY, gem.x, gem.y);
        if (length <= this.magnetRadius) gem.attracted = true;
        if (gem.attracted && length > 0.001) {
          const step = Math.min(length, speed * dt);
          gem.x += (this.heroX - gem.x) / length * step;
          gem.y += (this.heroY - gem.y) / length * step;
          length = Math.max(0, length - step);
        }
        if (length <= pickupRadius) {
          this.collectXp(gem.value);
          this.events.push({ type: "gem", x: gem.x, y: gem.y, value: gem.value });
        } else {
          survivors.push(gem);
        }
      }
      this.gems = survivors;
    }

    removeFarEnemies() {
      const limit = Number(this.config.spawning.remove_distance);
      for (const enemy of this.enemies) {
        if (!enemy.dead && !enemy.isBoss &&
          distance(this.heroX, this.heroY, enemy.x, enemy.y) > limit) {
          enemy.dead = true;
        }
      }
    }

    removeDeadEnemies() {
      const aliveIds = new Set(this.enemies.filter((enemy) => !enemy.dead).map((enemy) => enemy.id));
      this.enemies = this.enemies.filter((enemy) => !enemy.dead);
      for (const key of this.bladeHitTimes.keys()) {
        if (!aliveIds.has(Number(key.split(":")[0]))) this.bladeHitTimes.delete(key);
      }
    }

    damageEnemy(enemy, amount, source) {
      if (enemy.dead) return;
      enemy.hp -= amount;
      enemy.flashUntil = this.time + 0.08;
      this.events.push({
        type: "damage",
        source,
        amount,
        x: enemy.x,
        y: enemy.y,
        isBoss: enemy.isBoss,
      });
      if (enemy.hp <= 0) this.killEnemy(enemy);
    }

    killEnemy(enemy) {
      if (enemy.dead) return;
      enemy.dead = true;
      enemy.hp = 0;
      this.kills += 1;
      this.events.push({
        type: "kill",
        x: enemy.x,
        y: enemy.y,
        isBoss: enemy.isBoss,
        kind: enemy.kind,
      });
      if (enemy.xp > 0) this.addGem(enemy.x, enemy.y, enemy.xp);
    }

    addGem(x, y, value) {
      const gem = {
        id: this.nextGemId++,
        x,
        y,
        value: Number(value),
        attracted: false,
      };
      this.gems.push(gem);
      return gem;
    }

    collectXp(value) {
      this.xp += Number(value);
      while (this.xp >= this.xpToNext) {
        this.xp -= this.xpToNext;
        this.level += 1;
        this.xpToNext += Number(this.config.xp.need_increment);
        this.pendingLevels += 1;
      }
    }

    checkLevelUp() {
      if (this.mode !== "playing" || this.pendingLevels <= 0) return;
      this.pendingLevels -= 1;
      this.mode = "level_up";
      this.cards = this.buildCards();
      this.events.push({ type: "level_up", level: this.level });
    }

    buildCards() {
      const candidates = [];
      const weaponCount = Object.keys(this.weaponLevels).length;
      for (const [key, data] of Object.entries(this.config.weapons)) {
        const level = this.weaponLevels[key] || 0;
        if (level === 0 && weaponCount < 3) {
          candidates.push(this.weaponCard(key, data, 1, true));
        } else if (level > 0 && level < Number(data.max_level)) {
          candidates.push(this.weaponCard(key, data, level + 1, false));
        }
      }
      for (const [key, data] of Object.entries(this.config.passives)) {
        const level = this.passiveLevels[key] || 0;
        if (level < Number(data.max_level)) {
          candidates.push({
            id: `passive_${key}`,
            kind: "passive",
            key,
            title: data.name,
            titleZh: data.name_zh || data.name,
            levelLabel: `Lv ${level + 1}`,
            levelLabelZh: `${level + 1}级`,
            description: this.passiveDescription(key, data),
            descriptionZh: this.passiveDescriptionZh(key, data),
            accent: this.passiveAccent(key),
            resultLevel: level + 1,
          });
        }
      }

      this.shuffle(candidates);
      const chosen = candidates.slice(0, Number(this.config.xp.level_choices));
      while (chosen.length < Number(this.config.xp.level_choices)) {
        const amount = Number(this.config.upgrade.heal_amount);
        chosen.push({
          id: `heal_${chosen.length + 1}`,
          kind: "heal",
          key: "heal",
          title: "Field Rations",
          titleZh: "战地口粮",
          levelLabel: "Instant",
          levelLabelZh: "立即",
          description: `Restore ${amount} HP`,
          descriptionZh: `恢复 ${amount} 生命`,
          accent: "#72e8a5",
          resultLevel: 0,
        });
      }
      return chosen;
    }

    weaponCard(key, data, newLevel, isNew) {
      let description;
      let descriptionZh;
      let accent;
      if (key === "spark") {
        const damage = Number(data.damage) + Number(data.damage_per_level) * (newLevel - 1);
        const interval = Number(data.cooldown) - Number(data.cooldown_per_level) * (newLevel - 1);
        let count = Number(data.projectiles);
        for (const [levelReq, value] of Object.entries(data.projectiles_at_levels)) {
          if (newLevel >= Number(levelReq)) count = Number(value);
        }
        description = `${damage.toFixed(0)} dmg | ${interval.toFixed(2)}s | ${count} spark${count === 1 ? "" : "s"}`;
        descriptionZh = `伤害 ${damage.toFixed(0)} | 间隔 ${interval.toFixed(2)} 秒 | ${count} 道`;
        accent = "#58c8ff";
      } else if (key === "blades") {
        const damage = Number(data.damage) + Number(data.damage_per_level) * (newLevel - 1);
        let count = Number(data.blades);
        for (const [levelReq, value] of Object.entries(data.blades_at_levels)) {
          if (newLevel >= Number(levelReq)) count = Number(value);
        }
        description = `${count} blades | ${damage.toFixed(0)} dmg each`;
        descriptionZh = `${count} 把旋刃 | 每把 ${damage.toFixed(0)} 伤害`;
        accent = "#ffb84d";
      } else {
        const damage = Number(data.damage) + Number(data.damage_per_level) * (newLevel - 1);
        const radius = Number(data.radius) + Number(data.radius_per_level) * (newLevel - 1);
        description = `${radius.toFixed(0)} px aura | ${damage.toFixed(0)} dmg`;
        descriptionZh = `${radius.toFixed(0)} 范围伤害 | ${damage.toFixed(0)} 点`;
        accent = "#d99aff";
      }
      return {
        id: `${isNew ? "new" : "up"}_${key}`,
        kind: "weapon",
        key,
        title: data.name,
        titleZh: data.name_zh || data.name,
        levelLabel: isNew ? "NEW" : `Lv ${newLevel}`,
        levelLabelZh: isNew ? "全新" : `${newLevel}级`,
        description,
        descriptionZh,
        accent,
        resultLevel: newLevel,
      };
    }

    passiveDescription(key, data) {
      if (key === "boots") return `+${Number(data.speed_percent).toFixed(0)}% move speed`;
      if (key === "heart") {
        return `+${Number(data.max_hp).toFixed(0)} max HP | heal ${Number(data.heal).toFixed(0)}`;
      }
      return `+${Number(data.radius).toFixed(0)} px gem magnet`;
    }

    passiveDescriptionZh(key, data) {
      if (key === "boots") return `移动速度 +${Number(data.speed_percent).toFixed(0)}%`;
      if (key === "heart") {
        return `最大生命 +${Number(data.max_hp).toFixed(0)} | 恢复 ${Number(data.heal).toFixed(0)}`;
      }
      return `宝石拾取范围 +${Number(data.radius).toFixed(0)}`;
    }

    passiveAccent(key) {
      return { boots: "#ffd166", heart: "#ff6f91", magnet: "#52e4c4" }[key];
    }

    chooseCard(cardId) {
      if (this.mode !== "level_up") return false;
      const card = this.cards.find((item) => item.id === cardId);
      if (!card) return false;
      if (card.kind === "weapon") {
        this.weaponLevels[card.key] = card.resultLevel;
        if (card.key === "blades") {
          this.bladeAngle = -Math.PI / 2;
          this.bladeHitTimes.clear();
        }
        if (card.key === "holy") this.holyTimer = 0;
      } else if (card.kind === "passive") {
        this.passiveLevels[card.key] = card.resultLevel;
        if (card.key === "heart") {
          const data = this.config.passives.heart;
          this.maxHp += Number(data.max_hp);
          this.hp = Math.min(this.maxHp, this.hp + Number(data.heal));
        }
      } else if (card.kind === "heal") {
        this.hp = Math.min(this.maxHp, this.hp + Number(this.config.upgrade.heal_amount));
      }
      this.events.push({ type: "upgrade", key: card.key });
      this.cards = [];
      if (this.pendingLevels > 0) {
        this.pendingLevels -= 1;
        this.cards = this.buildCards();
      } else {
        this.mode = "playing";
      }
      return true;
    }

    nearestEnemy() {
      let nearest = null;
      let best = Infinity;
      for (const enemy of this.enemies) {
        if (enemy.dead) continue;
        const value = distance(this.heroX, this.heroY, enemy.x, enemy.y);
        if (value < best) {
          best = value;
          nearest = enemy;
        }
      }
      return nearest;
    }

    finish(mode) {
      if (this.mode === "game_over" || this.mode === "victory") return;
      this.mode = mode;
      this.events.push({ type: mode });
    }

    shuffle(items) {
      for (let index = items.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(this.rng() * (index + 1));
        [items[index], items[swap]] = [items[swap], items[index]];
      }
    }
  }

  window.NightSurvivors = { GameCore, TAU, clamp, distance };
})();
