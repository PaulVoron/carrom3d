import React from 'react';
import { GameCanvas } from './components/GameCanvas/GameCanvas';
import { ScoreBoard } from './components/ScoreBoard/ScoreBoard';
import { ConfirmButton } from './components/ConfirmButton/ConfirmButton';
import { GameOverPopup } from './components/GameOverPopup/GameOverPopup';
import { useGameStore } from './store/useGameStore';
import './styles/global.scss';

export const App = () => {
  const isReady = useGameStore((state) => state.isReady);

  return (
    <>
      <GameCanvas />
      {isReady && (
        <>
          <ScoreBoard />
          <ConfirmButton />
          <GameOverPopup />
        </>
      )}
    </>
  );
};
