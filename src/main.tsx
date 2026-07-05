import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

// No StrictMode: Fabric.js canvases are stateful DOM-bound instances and must
// not be double-initialized by StrictMode's mount/remount cycle.
createRoot(document.getElementById('root')!).render(<App />);
