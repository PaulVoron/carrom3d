/**
 * CustomizationTab.jsx
 *
 * Вкладка кастомизации визуала в SettingsModal.
 * Использует textures.js как конфиг для рендеринга всех опций.
 *
 * Структура вкладки:
 *  1. Биток (strikers)
 *  2. Фишки (coins)
 *  3. Поверхность стола (boardSurface)
 *  4. Паттерн стола (boardPattern)
 *  5. Борта (frames) + тумблер Matte/Glossy
 *  6. Углы лунок (pocketCorners)
 *  7. Окружение (environments)
 */

import React, { useCallback } from 'react';
import { useGameStore } from '../../store/useGameStore';
import { useTranslation } from '../../i18n/translations';
import textures from '../../engine/textures';
import styles from './CustomizationTab.module.scss';

// ─── Вспомогательная функция: получить опции категории (без служебных полей) ──

function getCategoryOptions(category) {
  return Object.entries(category).filter(
    ([key]) => key !== 'uiName' && key !== 'materialName'
  );
}

// ─── SkinCard — одна карточка-опция ──────────────────────────────────────────

function SkinCard({ id, cfg, isSelected, onClick, language }) {
  const label = cfg.uiName?.[language] ?? cfg.uiName?.['en'] ?? null;

  // Для environments — иконка-заглушка с CSS-градиентом по ID
  const isEnv = !cfg.map && !cfg.uiImage && cfg.file;

  return (
    <button
      className={`${styles.skinCard} ${isSelected ? styles.skinCardActive : ''}`}
      onClick={() => onClick(id)}
      title={label ?? id}
      aria-label={label ?? id}
      aria-pressed={isSelected}
    >
      <div className={styles.skinCardImage}>
        {cfg.uiImage ? (
          <img
            src={cfg.uiImage}
            alt={label ?? id}
            className={styles.skinCardImg}
            loading="lazy"
            onError={(e) => {
              e.currentTarget.style.display = 'none';
              e.currentTarget.nextSibling.style.display = 'flex';
            }}
          />
        ) : null}
        {/* CSS-заглушка — показывается если нет картинки или она не загрузилась */}
        <div
          className={`${styles.skinCardPlaceholder} ${isEnv ? styles[`env_${id}`] ?? styles.envDefault : ''}`}
          style={cfg.uiImage ? { display: 'none' } : {}}
          data-id={id}
        />
      </div>
      {label !== null && (
        <span className={styles.skinCardLabel}>{label}</span>
      )}
      {isSelected && (
        <div className={styles.skinCardCheck} aria-hidden="true">✓</div>
      )}
    </button>
  );
}

// ─── SkinPickerGrid — сетка карточек для одной категории ─────────────────────

function SkinPickerGrid({ categoryKey, category, selectedId, onSelect, language }) {
  const options = getCategoryOptions(category);
  const categoryLabel = category.uiName?.[language] ?? category.uiName?.['en'] ?? categoryKey;

  return (
    <div className={styles.pickerSection}>
      <div className={styles.sectionHeader}>
        <h3 className={styles.sectionTitle}>{categoryLabel}</h3>
      </div>
      <div className={styles.skinGrid}>
        {options.map(([id, cfg]) => (
          <SkinCard
            key={id}
            id={id}
            cfg={cfg}
            isSelected={selectedId === id}
            onClick={onSelect}
            language={language}
          />
        ))}
      </div>
    </div>
  );
}

// ─── FinishToggle — тумблер Matte / Glossy ───────────────────────────────────

function FinishToggle({ value, onChange, t }) {
  const isGlossy = value === 'glossy';

  return (
    <div className={styles.finishToggleWrapper}>
      <span className={`${styles.finishLabel} ${!isGlossy ? styles.finishLabelActive : ''}`}>
        {t('custom.matte')}
      </span>
      <button
        className={`${styles.toggleTrack} ${isGlossy ? styles.toggleTrackOn : ''}`}
        onClick={() => onChange(isGlossy ? 'matte' : 'glossy')}
        role="switch"
        aria-checked={isGlossy}
        aria-label={t('custom.frameFinish')}
      >
        <span className={styles.toggleThumb} />
      </button>
      <span className={`${styles.finishLabel} ${isGlossy ? styles.finishLabelActive : ''}`}>
        {t('custom.glossy')}
      </span>
    </div>
  );
}

// ─── CustomizationTab ─────────────────────────────────────────────────────────

export function CustomizationTab() {
  const { t, language } = useTranslation();
  const customization    = useGameStore((s) => s.settings.customization);
  const updateCustomization = useGameStore((s) => s.updateCustomization);

  const update = useCallback(
    (key, value) => updateCustomization(key, value),
    [updateCustomization]
  );

  const {
    strikerId,
    coinSkinId,
    boardSurfaceId,
    boardPatternId,
    frameId,
    frameFinish,
    pocketCornerId,
    environmentId,
  } = customization;

  const isSameAsFrame = pocketCornerId === 'sameAsFrame';

  return (
    <div className={styles.tabContent}>

      {/* 1. Биток */}
      <SkinPickerGrid
        categoryKey="strikers"
        category={textures.strikers}
        selectedId={strikerId}
        onSelect={(id) => update('strikerId', id)}
        language={language}
      />

      <div className={styles.divider} />

      {/* 2. Фишки */}
      <SkinPickerGrid
        categoryKey="coins"
        category={textures.coins}
        selectedId={coinSkinId}
        onSelect={(id) => update('coinSkinId', id)}
        language={language}
      />

      <div className={styles.divider} />

      {/* 3. Поверхность стола */}
      <SkinPickerGrid
        categoryKey="boardSurface"
        category={textures.boardSurface}
        selectedId={boardSurfaceId}
        onSelect={(id) => update('boardSurfaceId', id)}
        language={language}
      />

      <div className={styles.divider} />

      {/* 4. Паттерн стола */}
      <SkinPickerGrid
        categoryKey="boardPattern"
        category={textures.boardPattern}
        selectedId={boardPatternId}
        onSelect={(id) => update('boardPatternId', id)}
        language={language}
      />

      <div className={styles.divider} />

      {/* 5. Борта + тумблер */}
      <div className={styles.pickerSection}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>
            {textures.frames.uiName?.[language] ?? 'Frames'}
          </h3>
          {/* Тумблер Matte / Glossy */}
          <div className={styles.finishRow}>
            <span className={styles.finishLabelRow}>{t('custom.frameFinish')}:</span>
            <FinishToggle
              value={frameFinish}
              onChange={(v) => update('frameFinish', v)}
              t={t}
            />
          </div>
        </div>
        <div className={styles.skinGrid}>
          {getCategoryOptions(textures.frames).map(([id, cfg]) => (
            <SkinCard
              key={id}
              id={id}
              cfg={cfg}
              isSelected={frameId === id}
              onClick={(id) => update('frameId', id)}
              language={language}
            />
          ))}
        </div>
      </div>

      <div className={styles.divider} />

      {/* 6. Углы лунок */}
      <div className={styles.pickerSection}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>
            {textures.pocketCorners.uiName?.[language] ?? 'Pocket Corners'}
          </h3>
          {isSameAsFrame && (
            <div className={styles.sameAsFrameBadge}>
              🔗 {t('custom.sameAsFrame')}
            </div>
          )}
        </div>
        <div className={styles.skinGrid}>
          {getCategoryOptions(textures.pocketCorners).map(([id, cfg]) => (
            <SkinCard
              key={id}
              id={id}
              cfg={cfg}
              isSelected={pocketCornerId === id}
              onClick={(id) => update('pocketCornerId', id)}
              language={language}
            />
          ))}
        </div>
      </div>

      <div className={styles.divider} />

      {/* 7. Окружение */}
      <div className={styles.pickerSection}>
        <div className={styles.sectionHeader}>
          <h3 className={styles.sectionTitle}>
            {textures.environments.uiName?.[language] ?? 'Environment'}
          </h3>
        </div>
        <div className={styles.skinGrid}>
          {getCategoryOptions(textures.environments).map(([id, cfg]) => (
            <SkinCard
              key={id}
              id={id}
              cfg={cfg}
              isSelected={environmentId === id}
              onClick={(id) => update('environmentId', id)}
              language={language}
            />
          ))}
        </div>
      </div>

    </div>
  );
}
