import { createRoot } from 'react-dom/client';
import { MobilePlayer } from './components/MobilePlayer';
import './index.css';

createRoot(document.getElementById('mobile-root')!).render(<MobilePlayer />);
