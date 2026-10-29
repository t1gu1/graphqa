import { useEffect } from 'react';
import { Rail } from './components/Rail';
import { defaultState, migrate } from './lib/defaults';
import { loadState, saveState } from './lib/platform';
import { Library } from './screens/Library';
import { Settings } from './screens/Settings';
import { Workbench } from './screens/Workbench';
import { useStore } from './state/store';

export function App() {
  const ready = useStore((s) => s.ready);
  const screen = useStore((s) => s.screen);
  const theme = useStore((s) => s.data.settings.theme);
  const toast = useStore((s) => s.toast);

  // Chargement de l'état sauvegardé, puis sauvegarde automatique à chaque changement.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe = () => {};
    loadState().then((saved) => {
      useStore.getState().hydrate(saved ? migrate(saved) : defaultState());
      unsubscribe = useStore.subscribe((s, prev) => {
        if (s.data === prev.data) return;
        clearTimeout(timer);
        timer = setTimeout(() => saveState(useStore.getState().data), 400);
      });
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  if (!ready) return <div className="splash">Chargement…</div>;

  return (
    <div className="app">
      <Rail />
      {screen === 'workbench' && <Workbench />}
      {screen === 'library' && <Library />}
      {screen === 'settings' && <Settings />}
      {toast && (
        <div className={`toast${toast.tone === 'error' ? ' error' : ''}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}
