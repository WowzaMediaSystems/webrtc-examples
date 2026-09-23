import React, { Suspense, lazy } from 'react';
import {
  HashRouter as Router,
  Routes,
  Route,
  Navigate
} from "react-router-dom";
import { Provider as StoreProvider } from "react-redux";

import store from './store'

import Rail from './components/shell/Rail';
import Play from './components/play/Play';
import Publish from './components/publish/Publish';
import Loopback from './components/loopback/Loopback';

/*
 * Two of the five routes are separate demonstrations rather than parts of the console, and
 * each brings a compositor or a mesh of peer connections that the publish and play pages
 * never touch. Loading them on demand keeps that weight out of the first request, which is
 * the one the person opening the example waits for.
 *
 * Route level only. Everything inside a route stays eagerly imported, because the components
 * in there own device and track effects that have to run whether or not their tab is open.
 */
const Composite = lazy(() => import('./components/composite/Composite'));
const Meeting = lazy(() => import('./components/meeting/Meeting'));
import './styles/bootstrap.scss';
import './styles/shell.css';
import './styles/inspector.css';
import './styles/header.css';
import './styles/diagnostics.css';
import './styles/latency.css';
import './styles/sparkline.css';
import './styles/loopback.css';
import './App.css';

const App = () => {

  // Vite exposes build-time variables on import.meta.env and requires the VITE_ prefix.
  const basename = import.meta.env.VITE_BASENAME;

  let buildComponent = 'develop';
  if (basename != null && basename.indexOf('composite') > 0)
    buildComponent = 'composite';
  else if (basename != null && basename.indexOf('meeting') > 0)
    buildComponent = 'meeting';

  return (
    <StoreProvider store={store}>
      <Router>
        <div className="wz-app">
          <Rail buildComponent={ buildComponent }/>
          <Suspense fallback={<div className="wz-route-loading" role="status">Loading…</div>}>
          {buildComponent === 'develop' && (
            <Routes>
              <Route path="/play" element={<Play />} />
              <Route path="/meeting" element={<Meeting />} />
              <Route path="/composite" element={<Composite />} />
              <Route path="/publish" element={<Publish />} />
              <Route path="/loopback" element={<Loopback />} />
              <Route path="/" element={<Navigate to="/publish" replace />} />
            </Routes>
          )}
          {buildComponent === 'composite' && (
            <Routes>
              <Route path="*" element={<Composite />} />
            </Routes>
          )}
          {buildComponent === 'meeting' && (
            <Routes>
              <Route path="*" element={<Meeting />} />
            </Routes>
          )}
          </Suspense>
        </div>
      </Router>
    </StoreProvider>
  );
}

export default App;