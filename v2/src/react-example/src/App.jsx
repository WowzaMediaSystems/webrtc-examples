import React from 'react';
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
import Composite from './components/composite/Composite';
import Meeting from './components/meeting/Meeting';
import 'bootstrap/dist/css/bootstrap.css';
import './styles/shell.css';
import './styles/inspector.css';
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
          {buildComponent === 'develop' && (
            <Routes>
              <Route path="/play" element={<Play />} />
              <Route path="/meeting" element={<Meeting />} />
              <Route path="/composite" element={<Composite />} />
              <Route path="/publish" element={<Publish />} />
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
        </div>
      </Router>
    </StoreProvider>
  );
}

export default App;
