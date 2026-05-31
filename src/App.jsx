import React, { useState } from 'react';
import { GameCanvas } from './components/GameCanvas/GameCanvas';
import { ScoreBoard } from './components/ScoreBoard/ScoreBoard';
import { ConfirmButton } from './components/ConfirmButton/ConfirmButton';
import { GameOverPopup } from './components/GameOverPopup/GameOverPopup';
import { MainMenu } from './components/MainMenu/MainMenu';
import { useGameStore } from './store/useGameStore';
import { ColorAlert } from './components/ColorAlert/ColorAlert';
import { ColorSelectionPopup } from './components/ColorSelectionPopup/ColorSelectionPopup';
import { SettingsModal } from './components/SettingsModal/SettingsModal';
import { PyramidRotator } from './components/PyramidRotator/PyramidRotator';
import { FullscreenButton } from './components/FullscreenButton/FullscreenButton';
import { ChallengePopup } from './components/ChallengePopup/ChallengePopup';
import { useTranslation } from './i18n/translations';
import './styles/global.scss';

export const App = () => {
  const isReady = useGameStore((state) => state.isReady);
  const gameMode = useGameStore((state) => state.gameMode);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const { t } = useTranslation();

  return (
    <>
      {/* Заглушка для портретного режима (скрыта в landscape через CSS) */}
      <div className="portrait-overlay" role="alert" aria-live="polite">
        <div className="portrait-overlay__icon">📱</div>
        <p className="portrait-overlay__text">{t('rotate.message')}</p>
      </div>
      <GameCanvas />

      {/* Кнопка полноэкранного режима доступна на всех экранах */}
      <FullscreenButton />

      {/* SettingsModal доступен всегда — и в меню, и в игре */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      {!isReady && (
        <MainMenu onOpenSettings={() => setIsSettingsOpen(true)} />
      )}

      {isReady && (
        <>
          <ScoreBoard />
          {gameMode !== 'challenge' && <PyramidRotator />}
          <ConfirmButton />
          <GameOverPopup />
          <ColorAlert />
          <ColorSelectionPopup />
          <ChallengePopup />

          {/* Кнопка-шестерёнка в игре */}
          <button
            id="in-game-settings-btn"
            onClick={() => setIsSettingsOpen(true)}
            style={{
              position: 'fixed',
              top: '12px',
              right: '12px',
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(15,15,22,0.75)',
              backdropFilter: 'blur(8px)',
              color: 'rgba(255,255,255,0.7)',
              fontSize: '18px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 1500,
              transition: 'background 0.18s, color 0.18s, transform 0.18s',
              lineHeight: 1,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(79,140,255,0.30)';
              e.currentTarget.style.color = '#fff';
              e.currentTarget.style.transform = 'rotate(30deg)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(15,15,22,0.75)';
              e.currentTarget.style.color = 'rgba(255,255,255,0.7)';
              e.currentTarget.style.transform = 'rotate(0deg)';
            }}
            title="Settings"
            aria-label="Open Settings"
          >
            ⚙
          </button>
        </>
      )}
    </>
  );
};
