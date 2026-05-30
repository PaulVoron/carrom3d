/**
 * SettingsModal.jsx
 * Модальное окно настроек — поверх Canvas, glassmorphism-стилизация.
 *
 * Открытие:
 *   — из MainMenu через кнопку «Налаштування»
 *   — в игре через кнопку-шестерёнку (⚙) добавленную в App.jsx
 *
 * Данные: читает / пишет в useGameStore.settings через updateSetting().
 *         Настройки строго локальные — не попадают в сетевую синхронизацию.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { useTranslation } from '../../i18n/translations';
import styles from './SettingsModal.module.scss';

// ─── Конфиг опций скинов ──────────────────────────────────────────────────────

const SKIN_OPTIONS = {
  boardTexture: [
    { value: '/textures/board_default.jpg', labelKey: 'skins.board.default' },
    { value: '/textures/board_marble.jpg',  labelKey: 'skins.board.marble'  },
    { value: '/textures/board_dark.jpg',    labelKey: 'skins.board.dark'    },
  ],
  frameTexture: [
    { value: '/textures/frame_default.jpg',  labelKey: 'skins.frame.default'  },
    { value: '/textures/frame_mahogany.jpg', labelKey: 'skins.frame.mahogany' },
    { value: '/textures/frame_walnut.jpg',   labelKey: 'skins.frame.walnut'   },
  ],
  strikerTexture: [
    { value: '/textures/striker_default.jpg', labelKey: 'skins.striker.default' },
    { value: '/textures/striker_gold.jpg',    labelKey: 'skins.striker.gold'    },
    { value: '/textures/striker_carbon.jpg',  labelKey: 'skins.striker.carbon'  },
  ],
  coinColorSet: [
    { value: 'default', labelKey: 'skins.coins.default' },
    { value: 'golden',  labelKey: 'skins.coins.golden'  },
    { value: 'classic', labelKey: 'skins.coins.classic' },
  ],
  environmentMap: [
    { value: '/hdr/default.hdr', labelKey: 'skins.env.default'  },
    { value: '/hdr/outdoor.hdr', labelKey: 'skins.env.outdoor'  },
    { value: '/hdr/night.hdr',   labelKey: 'skins.env.night'    },
  ],
};

// ─── VolumeSlider ──────────────────────────────────────────────────────────────

function VolumeSlider({ label, value, onChange }) {
  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderLabel}>{label}</span>
      <div className={styles.sliderTrack}>
        <input
          type="range"
          min={0} max={1} step={0.01}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className={styles.slider}
          style={{ '--pct': `${Math.round(value * 100)}%` }}
        />
      </div>
      <span className={styles.sliderValue}>{Math.round(value * 100)}</span>
    </div>
  );
}

// ─── SkinSelect ───────────────────────────────────────────────────────────────

function SkinSelect({ label, optionKey, value, onChange, t }) {
  const options = SKIN_OPTIONS[optionKey] ?? [];
  return (
    <div className={styles.skinRow}>
      <span className={styles.skinLabel}>{label}</span>
      <div className={styles.skinButtons}>
        {options.map((opt) => (
          <button
            key={opt.value}
            className={`${styles.skinBtn} ${value === opt.value ? styles.skinBtnActive : ''}`}
            onClick={() => onChange(opt.value)}
            title={t(opt.labelKey)}
          >
            {t(opt.labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── SettingsModal ────────────────────────────────────────────────────────────

export const SettingsModal = ({ isOpen, onClose }) => {
  const { t } = useTranslation();
  const settings      = useGameStore((state) => state.settings);
  const language      = useGameStore((state) => state.language);
  const updateSetting = useGameStore((state) => state.updateSetting);
  const setLanguage   = useGameStore((state) => state.setLanguage);

  const [activeTab, setActiveTab] = useState('audio');

  // Закрытие по Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const handleVolume = useCallback(
    (key, value) => updateSetting('volume', key, value),
    [updateSetting]
  );

  const handleSkin = useCallback(
    (key, value) => updateSetting('skins', key, value),
    [updateSetting]
  );

  if (!isOpen) return null;

  return (
    <div
      className={styles.backdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={t('settings.title')}
    >
      <div className={styles.modal}>

        {/* ── Заголовок ── */}
        <div className={styles.header}>
          <h2 className={styles.title}>{t('settings.title')}</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label={t('settings.close')}>
            ✕
          </button>
        </div>

        {/* ── Вкладки ── */}
        <div className={styles.tabs}>
          <button
            id="settings-tab-audio"
            className={`${styles.tab} ${activeTab === 'audio' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('audio')}
          >
            {t('settings.tabAudio')}
          </button>
          <button
            id="settings-tab-customize"
            className={`${styles.tab} ${activeTab === 'customize' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('customize')}
          >
            {t('settings.tabCustomization')}
          </button>
          <button
            id="settings-tab-gameplay"
            className={`${styles.tab} ${activeTab === 'gameplay' ? styles.tabActive : ''}`}
            onClick={() => setActiveTab('gameplay')}
          >
            {t('settings.tabGameplay')}
          </button>
        </div>

        {/* ── Содержимое вкладки: Аудіо & Мова ── */}
        {activeTab === 'audio' && (
          <div className={styles.tabContent}>

            <div className={styles.sectionTitle}>{t('settings.volumeMaster').split(' ')[0]}</div>

            <VolumeSlider
              label={t('settings.volumeMaster')}
              value={settings.volume.master}
              onChange={(v) => handleVolume('master', v)}
            />
            <VolumeSlider
              label={t('settings.volumeSfx')}
              value={settings.volume.sfx}
              onChange={(v) => handleVolume('sfx', v)}
            />
            <VolumeSlider
              label={t('settings.volumeVoice')}
              value={settings.volume.voice}
              onChange={(v) => handleVolume('voice', v)}
            />
            <VolumeSlider
              label={t('settings.volumeUi')}
              value={settings.volume.ui}
              onChange={(v) => handleVolume('ui', v)}
            />

            <div className={styles.divider} />

            <div className={styles.sectionTitle}>{t('settings.language')}</div>
            <div className={styles.langToggle}>
              <button
                id="settings-lang-uk"
                className={`${styles.langBtn} ${language === 'uk' ? styles.langBtnActive : ''}`}
                onClick={() => setLanguage('uk')}
              >
                🇺🇦 {t('settings.langUk')}
              </button>
              <button
                id="settings-lang-en"
                className={`${styles.langBtn} ${language === 'en' ? styles.langBtnActive : ''}`}
                onClick={() => setLanguage('en')}
              >
                🇺🇸 {t('settings.langEn')}
              </button>
            </div>
          </div>
        )}

        {/* ── Содержимое вкладки: Кастомізація ── */}
        {activeTab === 'customize' && (
          <div className={styles.tabContent}>
            <SkinSelect
              label={t('settings.boardTexture')}
              optionKey="boardTexture"
              value={settings.skins.boardTexture}
              onChange={(v) => handleSkin('boardTexture', v)}
              t={t}
            />
            <SkinSelect
              label={t('settings.frameTexture')}
              optionKey="frameTexture"
              value={settings.skins.frameTexture}
              onChange={(v) => handleSkin('frameTexture', v)}
              t={t}
            />
            <SkinSelect
              label={t('settings.strikerTexture')}
              optionKey="strikerTexture"
              value={settings.skins.strikerTexture}
              onChange={(v) => handleSkin('strikerTexture', v)}
              t={t}
            />
            <SkinSelect
              label={t('settings.coinColorSet')}
              optionKey="coinColorSet"
              value={settings.skins.coinColorSet}
              onChange={(v) => handleSkin('coinColorSet', v)}
              t={t}
            />
            <SkinSelect
              label={t('settings.environmentMap')}
              optionKey="environmentMap"
              value={settings.skins.environmentMap}
              onChange={(v) => handleSkin('environmentMap', v)}
              t={t}
            />
          </div>
        )}

        {/* ── Содержимое вкладки: Геймплей ── */}
        {activeTab === 'gameplay' && (
          <div className={styles.tabContent}>

            {/* ── Таймер хода ── */}
            <div className={styles.sectionTitle}>{t('settings.turnTimeLimit')}</div>
            <div className={styles.radioGroup}>
              {[15, 30, 60, 180, 0].map((val) => (
                <button
                  key={val}
                  id={`settings-time-${val}`}
                  className={`${styles.radioBtn} ${settings.gameplay?.turnTimeLimit === val ? styles.radioBtnActive : ''}`}
                  onClick={() => updateSetting('gameplay', 'turnTimeLimit', val)}
                >
                  {t(`settings.turnTime.${val}`)}
                </button>
              ))}
            </div>

            <div className={styles.divider} />

            {/* ── Стиль пирамиды ── */}
            <div className={styles.sectionTitle}>{t('settings.pyramidStyle')}</div>
            <div className={styles.skinButtons}>
              {['classic', 'random'].map((val) => (
                <button
                  key={val}
                  id={`settings-pyramid-${val}`}
                  className={`${styles.skinBtn} ${settings.gameplay?.pyramidStyle === val ? styles.skinBtnActive : ''}`}
                  onClick={() => updateSetting('gameplay', 'pyramidStyle', val)}
                >
                  {t(`settings.pyramid.${val}`)}
                </button>
              ))}
            </div>

          </div>
        )}

      </div>
    </div>
  );
};
