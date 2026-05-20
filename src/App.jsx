import React from 'react';
import { GameCanvas } from './components/GameCanvas/GameCanvas';
import { ScoreBoard } from './components/ScoreBoard/ScoreBoard';
import { ConfirmButton } from './components/ConfirmButton/ConfirmButton';
import { GameOverPopup } from './components/GameOverPopup/GameOverPopup';
import { MainMenu } from './components/MainMenu/MainMenu';
import { useGameStore } from './store/useGameStore';
import { ColorAlert } from './components/ColorAlert/ColorAlert';
import './styles/global.scss';

export const App = () => {
  const isReady = useGameStore((state) => state.isReady);

  return (
    <>
      <GameCanvas />
      {!isReady && <MainMenu />}
      {isReady && (
        <>
          <ScoreBoard />
          <ConfirmButton />
          <GameOverPopup />
          <ColorAlert />
        </>
      )}
    </>
  );
};
