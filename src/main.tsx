import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { createBackend } from './backend/index.ts';
import './ui/fonts.css';
import './ui/styles.css';
import { brand } from './config.ts';

document.title = `${brand.name} · Consultório`;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App backend={createBackend()} />
  </StrictMode>,
);
