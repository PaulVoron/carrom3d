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

/**
 * Манифест голосовых реплик.
 *
 * Два паттерна на выбор:
 *
 * Паттерн A — count-based (авто-индекс):
 *   Файлы именуются: /audio/voice/{lang}/{key}_{0,1,2,...}.ogg
 *   Чтобы добавить вариант — просто бросьте файл и увеличьте count.
 *   Пример: voice_wow: { en: { count: 3 }, uk: { count: 2 } }
 *            → en: voice_wow_0.ogg, voice_wow_1.ogg, voice_wow_2.ogg
 *
 * Паттерн B — explicit files list:
 *   Файлы именуются произвольно (без суффикса _N).
 *   Пример: voice_wow: { en: { files: ['voice_wow_cool', 'voice_wow_epic'] }, uk: { count: 2 } }
 *            → en: voice_wow_cool.ogg, voice_wow_epic.ogg (случайно)
 *
 * Совмещение: разные языки могут использовать разные паттерны.
 *
 * @type {Record<string, Record<string, {count?: number, files?: string[]}>>}
 */
const VOICE_MANIFEST = {
  voice_foul:           { en: { count: 2 }, uk: { count: 2 } },
  voice_queen_covered:  { en: { count: 2 }, uk: { count: 2 } },
  voice_queen_pocketed: { en: { count: 2 }, uk: { count: 2 } },
  voice_start_game:     { en: { count: 3 }, uk: { count: 4 } },
  voice_wow:            { en: { count: 2 }, uk: { count: 2 } },
  voice_you_lose:       { en: { count: 2 }, uk: { count: 2 } },
  voice_you_win:        { en: { count: 2 }, uk: { count: 2 } },
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

    // ── Множители громкости (из стора) ───────────────────────────────────
    this._volMaster = 1.0;
    this._volSfx    = 1.0;
    this._volVoice  = 1.0;
    this._volUi     = 1.0;

    /** @type {Function | null} Отписка от Zustand */
    this._storeUnsub = null;

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

    // ── Подписка на изменения громкости в Zustand ─────────────────────────
    this._applyVolumeFromStore();
    this._storeUnsub = useGameStore.subscribe(
      (state) => state.settings.volume,
      () => this._applyVolumeFromStore(),
      { equalityFn: (a, b) =>
          a.master === b.master &&
          a.sfx    === b.sfx    &&
          a.voice  === b.voice  &&
          a.ui     === b.ui
      }
    );
  }

  /**
   * Читает текущие значения громкости из стора и применяет их.
   * Вызывается при инициализации и при каждом изменении стора.
   * Не блокирует RAF — только устанавливает числа.
   */
  _applyVolumeFromStore() {
    const { master, sfx, voice, ui } = useGameStore.getState().settings.volume;
    this._volMaster = master;
    this._volSfx    = sfx;
    this._volVoice  = voice;
    this._volUi     = ui;

    // Применяем master к AudioListener (влияет на все THREE.Audio сразу)
    if (this._listener) {
      this._listener.setMasterVolume(master);
    }
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

    // Динамическая громкость с учётом sfx-множителя из настроек
    const raw    = Math.min(Math.max(forceMag / MAX_FORCE_MAG, MIN_POSITIONAL_VOL), 1.0);
    const volume = raw * volumeMultiplier * this._volSfx;

    const pa = this._getFreePositional();

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
    // UI-звуки масштабируются на ui-множитель
    sound.setVolume(volume * this._volUi);

    const ctx = this._listener.context;
    if (ctx && ctx.state !== 'running') {
      ctx.resume().then(() => sound.play()).catch(() => {});
    } else {
      sound.play();
    }
  }

  /**
   * Воспроизвести голосовой звук с учётом текущего языка.
   * Файлы загружаются лениво при первом обращении.
   * @param {string} key    — напр. 'voice_start_game', 'voice_foul'
   * @param {number} volume — громкость от 0.0 до 1.0
   */
  playVoice(key, volume = 1.0) {
    console.log(`[AudioManager] playVoice called for key: "${key}" (volume: ${volume})`);
    if (!this._listener) {
      console.warn('[AudioManager] Cannot play voice: listener is null');
      return;
    }
    if (!this._initialized) {
      console.warn('[AudioManager] Cannot play voice: AudioManager is not initialized');
      return;
    }

    // Язык читается прямо сейчас, чтобы смена языка в настройках сразу отражалась
    // на следующем голосовом событии (даже в середине игры).
    const lang = useGameStore.getState().language ?? 'uk';
    const manifestEntry = VOICE_MANIFEST[key];
    if (!manifestEntry) {
      console.warn(`[AudioManager] No manifest entry for voice key: "${key}"`);
      return;
    }

    // Разрешаем языковую конфигурацию (с фолбэком на 'en')
    const langConfig = manifestEntry[lang] ?? manifestEntry['en'] ?? { count: 1 };

    // Выбираем случайный файл в зависимости от паттерна манифеста
    let cacheKey, url;
    if (Array.isArray(langConfig.files) && langConfig.files.length > 0) {
      // Паттерн B: явный список файлов
      const fileName = langConfig.files[Math.floor(Math.random() * langConfig.files.length)];
      cacheKey = `${lang}_${fileName}`;
      url      = `/audio/voice/${lang}/${fileName}.ogg`;
    } else {
      // Паттерн A: авто-индексация (key_0.ogg, key_1.ogg …)
      const count = langConfig.count ?? 1;
      const idx   = Math.floor(Math.random() * count);
      cacheKey = `${lang}_${key}_${idx}`;
      url      = `/audio/voice/${lang}/${key}_${idx}.ogg`;
    }

    console.log(`[AudioManager] Selected voice file: "${url}", cacheKey: "${cacheKey}"`);

    const _play = (buffer) => {
      if (!this._voiceSound) {
        this._voiceSound = new THREE.Audio(this._listener);
      }
      if (this._voiceSound.isPlaying) {
        console.log('[AudioManager] Voice sound is currently playing, stopping it first.');
        this._voiceSound.stop();
      }
      this._voiceSound.setBuffer(buffer);
      
      const finalVolume = volume * this._volVoice;
      this._voiceSound.setVolume(finalVolume);
      console.log(`[AudioManager] Set voice volume to: ${finalVolume} (multiplier: ${this._volVoice})`);

      // WebAudio context может быть заморожен если play() вызывается
      // сразу после первого пользовательского действия (браузерная политика).
      // resume() — no-op если контекст уже running.
      const ctx = this._listener.context;
      if (ctx && ctx.state !== 'running') {
        console.log(`[AudioManager] AudioContext state is "${ctx.state}". Resuming context...`);
        ctx.resume()
          .then(() => {
            console.log('[AudioManager] AudioContext resumed, playing voice sound.');
            this._voiceSound.play();
          })
          .catch((err) => {
            console.error('[AudioManager] Failed to resume AudioContext:', err);
          });
      } else {
        console.log('[AudioManager] AudioContext is running, playing voice sound.');
        this._voiceSound.play();
      }
    };

    if (this._buffers.has(cacheKey)) {
      console.log(`[AudioManager] Playing voice from cache: "${cacheKey}"`);
      _play(this._buffers.get(cacheKey));
    } else {
      console.log(`[AudioManager] Voice not in cache, loading from: "${url}"`);
      this._loader.load(
        url,
        (buffer) => {
          console.log(`[AudioManager] Successfully loaded voice: "${url}"`);
          this._buffers.set(cacheKey, buffer);
          _play(buffer);
        },
        undefined,
        (err) => console.warn(`[AudioManager] Voice missing or failed to load: ${url}`, err)
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

    // Отписываемся от Zustand
    if (this._storeUnsub) {
      this._storeUnsub();
      this._storeUnsub = null;
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
