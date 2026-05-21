/**
 * AudioManager.js
 * Синглтон аудио-системы для Carrom 3D.
 *
 * Инициализация: audioManager.init(camera, scene) → audioManager.preload()
 *
 * Архитектура:
 *  - THREE.AudioListener прикреплён к камере
 *  - SFX (sfx_*): позиционные (THREE.PositionalAudio), пул из 12 экземпляров
 *  - UI-звуки (ui_*): глобальные (THREE.Audio)
 *  - Голос (voice_*): глобальный, lazy-load по языку из useGameStore
 *  - sfx_slide: зацикленный глобальный, fade-out через GSAP
 */

import * as THREE from 'three';
import gsap from 'gsap';
import { useGameStore } from '../store/useGameStore.js';

// ─── Манифест SFX ─────────────────────────────────────────────────────────────

/**
 * count  — число вариантов файлов.
 * indexed — true  → файлы key_0.ogg, key_1.ogg ...
 *            false → один файл, имя = key.ogg
 */
const SFX_MANIFEST = {
  sfx_coin_hit:            { count: 4, indexed: true  },
  sfx_coin_pocket_drop:    { count: 2, indexed: true  },
  sfx_coin_wall_hit:       { count: 2, indexed: true  },
  sfx_striker_wall_hit:    { count: 3, indexed: true  },
  sfx_strike:              { count: 2, indexed: true  },
  sfx_striker_pocket_drop: { count: 1, indexed: false },
  sfx_slide:               { count: 1, indexed: false },
  ui_applause:             { count: 1, indexed: false },
  ui_turn_switch:          { count: 1, indexed: false },
  ui_due_spawn:            { count: 1, indexed: false },
};

/** Количество вариантов голосовых файлов на каждый язык */
const VOICE_MANIFEST = {
  voice_foul:           { en: 2, uk: 2 },
  voice_queen_covered:  { en: 2, uk: 2 },
  voice_queen_pocketed: { en: 2, uk: 2 },
  voice_start_game:     { en: 3, uk: 4 },
  voice_wow:            { en: 2, uk: 2 },
  voice_you_lose:       { en: 2, uk: 2 },
  voice_you_win:        { en: 2, uk: 2 },
};

// ─── Константы ────────────────────────────────────────────────────────────────

/** Размер пула позиционных источников */
const POSITIONAL_POOL_SIZE = 12;

/**
 * Максимальное значение totalForceMagnitude (Rapier),
 * при котором громкость позиционного звука = 1.0.
 */
const MAX_FORCE_MAG = 3.0;

/** Минимальная громкость позиционного звука (не совсем беззвучный) */
const MIN_POSITIONAL_VOL = 0.05;

/** Громкость slide-звука при движении битка */
const SLIDE_VOLUME = 0.3;

// ─── AudioManager ─────────────────────────────────────────────────────────────

class AudioManager {
  constructor() {
    /** @type {THREE.AudioListener | null} */
    this._listener = null;

    /** @type {THREE.AudioLoader} */
    this._loader = new THREE.AudioLoader();

    /** @type {Map<string, AudioBuffer>} */
    this._buffers = new Map();

    /** @type {THREE.Scene | null} */
    this._scene = null;

    /** Пул позиционных источников звука @type {THREE.PositionalAudio[]} */
    this._positionalPool = [];

    // ── Slide-звук (зацикленный, глобальный) ─────────────────────────────
    /** @type {THREE.Audio | null} */
    this._slideSound = null;
    /** @type {gsap.core.Tween | null} */
    this._slideFadeTween = null;
    /** Прокси-объект для GSAP (volume) */
    this._slideProxy = { vol: 0 };

    // ── Глобальные UI-звуки (один экземпляр на ключ) ─────────────────────
    /** @type {Map<string, THREE.Audio>} */
    this._globalSounds = new Map();

    // ── Голосовой звук (один активный голос одновременно) ────────────────
    /** @type {THREE.Audio | null} */
    this._voiceSound = null;

    this._initialized = false;
  }

  // ─── Инициализация ────────────────────────────────────────────────────────

  /**
   * Инициализировать AudioManager.
   * Вызывать ОДИН раз после создания сцены.
   * @param {THREE.Camera} camera
   * @param {THREE.Scene}  scene
   */
  init(camera, scene) {
    if (this._initialized) return;
    this._initialized = true;

    this._scene = scene;
    this._listener = new THREE.AudioListener();
    camera.add(this._listener);

    // Создаём пул позиционных источников и добавляем их в корень сцены
    for (let i = 0; i < POSITIONAL_POOL_SIZE; i++) {
      const pa = new THREE.PositionalAudio(this._listener);
      pa.setRefDistance(0.5);
      pa.setRolloffFactor(2.0);
      pa.setDistanceModel('exponential');
      scene.add(pa);
      this._positionalPool.push(pa);
    }

    // Создаём зацикленный слайд-звук
    this._slideSound = new THREE.Audio(this._listener);
    this._slideSound.setLoop(true);
    this._slideSound.setVolume(0);
  }

  // ─── Предзагрузка ─────────────────────────────────────────────────────────

  /**
   * Предзагрузить все SFX-буферы из манифеста.
   * Голосовые файлы загружаются лениво при первом обращении.
   * @returns {Promise<void>}
   */
  async preload() {
    const loads = [];

    for (const [key, { count, indexed }] of Object.entries(SFX_MANIFEST)) {
      if (!indexed || count === 1) {
        // Один файл без суффикса: sfx_slide.ogg, ui_applause.ogg и т.д.
        loads.push(this._loadBuffer(`/audio/sfx/${key}.ogg`, key));
      } else {
        // Несколько вариантов: sfx_coin_hit_0.ogg, sfx_coin_hit_1.ogg ...
        for (let i = 0; i < count; i++) {
          loads.push(this._loadBuffer(`/audio/sfx/${key}_${i}.ogg`, `${key}_${i}`));
        }
      }
    }

    await Promise.allSettled(loads);

    // Подключаем буфер к слайд-звуку
    const slideBuffer = this._buffers.get('sfx_slide');
    if (slideBuffer && this._slideSound) {
      this._slideSound.setBuffer(slideBuffer);
    }

    console.log(`[AudioManager] Preloaded ${this._buffers.size} SFX buffers.`);
  }

  /**
   * Загрузить один буфер и сохранить по ключу.
   * @param {string} url
   * @param {string} key
   * @returns {Promise<void>}
   */
  _loadBuffer(url, key) {
    return new Promise((resolve) => {
      this._loader.load(
        url,
        (buffer) => { this._buffers.set(key, buffer); resolve(); },
        undefined,
        () => { console.warn(`[AudioManager] Missing audio: ${url}`); resolve(); }
      );
    });
  }

  // ─── Выбор буфера ─────────────────────────────────────────────────────────

  /**
   * Случайно выбрать вариант SFX из буферного кеша.
   * @param {string} key — базовый ключ (напр. 'sfx_coin_hit')
   * @returns {AudioBuffer | null}
   */
  _pickSfxBuffer(key) {
    const def = SFX_MANIFEST[key];
    if (!def) return null;

    if (!def.indexed || def.count === 1) {
      return this._buffers.get(key) ?? null;
    }

    const idx = Math.floor(Math.random() * def.count);
    return this._buffers.get(`${key}_${idx}`) ?? null;
  }

  // ─── Пул позиционных звуков ───────────────────────────────────────────────

  /**
   * Взять свободный PositionalAudio из пула.
   * Если все заняты — прерываем самый первый.
   * @returns {THREE.PositionalAudio}
   */
  _getFreePositional() {
    for (const pa of this._positionalPool) {
      if (!pa.isPlaying) return pa;
    }
    // Все заняты — переиспользуем первый
    const pa = this._positionalPool[0];
    pa.stop();
    return pa;
  }

  // ─── Публичное API ────────────────────────────────────────────────────────

  /**
   * Воспроизвести позиционный звук удара.
   * Позиция звука = мировые координаты mesh.
   *
   * @param {THREE.Object3D} mesh             — источник позиции (фишка / борт)
   * @param {string}         key              — ключ из SFX_MANIFEST
   * @param {number}         forceMag         — totalForceMagnitude из Rapier (0…∞)
   * @param {number}         volumeMultiplier — множитель громкости
   */
  playPositional(mesh, key, forceMag = 1.0, volumeMultiplier = 10) {
    if (!this._listener || !this._initialized) return;

    const buffer = this._pickSfxBuffer(key);
    if (!buffer) return;

    // Динамическая громкость: тихий удар → тихий звук
    const volume = Math.min(Math.max(forceMag / MAX_FORCE_MAG, MIN_POSITIONAL_VOL), 1.0) * volumeMultiplier;

    const pa = this._getFreePositional();

    // Выставляем позицию по мировым координатам меша
    if (mesh) {
      mesh.getWorldPosition(pa.position);
    }

    pa.setBuffer(buffer);
    pa.setVolume(volume);
    pa.play();
  }

  /**
   * Воспроизвести глобальный UI-звук (без позиции).
   * @param {string} key    — напр. 'ui_applause', 'ui_turn_switch'
   * @param {number} volume — громкость от 0.0 до 1.0
   */
  playGlobal(key, volume = 1.0) {
    if (!this._listener || !this._initialized) return;

    const buffer = this._buffers.get(key);
    if (!buffer) return;

    if (!this._globalSounds.has(key)) {
      this._globalSounds.set(key, new THREE.Audio(this._listener));
    }

    const sound = this._globalSounds.get(key);
    if (sound.isPlaying) sound.stop();
    sound.setBuffer(buffer);
    sound.setVolume(volume);
    sound.play();
  }

  /**
   * Воспроизвести голосовой звук с учётом текущего языка.
   * Файлы загружаются лениво при первом обращении.
   * @param {string} key    — напр. 'voice_start_game', 'voice_foul'
   * @param {number} volume — громкость от 0.0 до 1.0
   */
  playVoice(key, volume = 1.0) {
    if (!this._listener || !this._initialized) return;

    const lang = useGameStore.getState().language ?? 'uk';
    const counts = VOICE_MANIFEST[key];
    if (!counts) return;

    const count = counts[lang] ?? counts['en'] ?? 1;
    const idx   = Math.floor(Math.random() * count);
    const cacheKey = `${lang}_${key}_${idx}`;
    const url      = `/audio/voice/${lang}/${key}_${idx}.ogg`;

    const _play = (buffer) => {
      if (!this._voiceSound) {
        this._voiceSound = new THREE.Audio(this._listener);
      }
      if (this._voiceSound.isPlaying) this._voiceSound.stop();
      this._voiceSound.setBuffer(buffer);
      this._voiceSound.setVolume(volume);
      this._voiceSound.play();
    };

    if (this._buffers.has(cacheKey)) {
      _play(this._buffers.get(cacheKey));
    } else {
      // Lazy-load: загружаем и воспроизводим
      this._loader.load(
        url,
        (buffer) => { this._buffers.set(cacheKey, buffer); _play(buffer); },
        undefined,
        () => console.warn(`[AudioManager] Voice missing: ${url}`)
      );
    }
  }

  // ─── Slide-звук ───────────────────────────────────────────────────────────

  /**
   * Запустить зацикленный slide-звук (движение битка в PLACEMENT).
   * Идемпотентен: повторный вызов ничего не делает если уже играет.
   */
  startSlide() {
    if (!this._slideSound?.buffer || !this._initialized) return;

    // Убиваем fade-out, если он выполняется
    if (this._slideFadeTween) {
      this._slideFadeTween.kill();
      this._slideFadeTween = null;
    }

    if (!this._slideSound.isPlaying) {
      this._slideSound.setVolume(SLIDE_VOLUME);
      this._slideSound.play();
    }
  }

  /**
   * Плавно остановить slide-звук через GSAP fade-out.
   * @param {number} fadeDurationMs — длительность затухания в мс (по умолчанию 200)
   */
  stopSlide(fadeDurationMs = 200) {
    if (!this._slideSound?.isPlaying) return;

    const sound = this._slideSound;
    this._slideProxy.vol = sound.getVolume();

    this._slideFadeTween = gsap.to(this._slideProxy, {
      vol:      0,
      duration: fadeDurationMs / 1000,
      ease:     'power1.out',
      onUpdate:  () => sound.setVolume(this._slideProxy.vol),
      onComplete: () => {
        if (sound.isPlaying) sound.stop();
        this._slideFadeTween = null;
      },
    });
  }

  // ─── Очистка ──────────────────────────────────────────────────────────────

  /**
   * Освободить все ресурсы (вызвать при уничтожении сцены).
   */
  dispose() {
    // Остановить и убрать из сцены пул позиционных источников
    for (const pa of this._positionalPool) {
      if (pa.isPlaying) pa.stop();
      if (pa.parent) pa.parent.remove(pa);
    }
    this._positionalPool = [];

    // Остановить глобальные звуки
    for (const sound of this._globalSounds.values()) {
      if (sound.isPlaying) sound.stop();
    }
    this._globalSounds.clear();

    // Остановить slide и voice
    if (this._slideSound?.isPlaying) this._slideSound.stop();
    if (this._voiceSound?.isPlaying) this._voiceSound.stop();

    // Убиваем GSAP-твины
    if (this._slideFadeTween) {
      this._slideFadeTween.kill();
      this._slideFadeTween = null;
    }

    // Убираем listener с камеры
    if (this._listener?.parent) {
      this._listener.parent.remove(this._listener);
    }
    this._listener = null;
    this._scene    = null;
    this._buffers.clear();
    this._initialized = false;
  }
}

// ─── Синглтон ─────────────────────────────────────────────────────────────────

export const audioManager = new AudioManager();
