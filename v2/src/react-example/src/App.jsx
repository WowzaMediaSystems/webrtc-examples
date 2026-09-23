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
import TrackEnabledSync from './components/shared/TrackEnabledSync';
import Play from './components/play/Play';
import Publish from './components/publish/Publish';
import 'bootstrap/dist/css/bootstrap.css';
import './styles/shell.css';
import './styles/inspector.css';
import './App.css';

const App = () => {

  return (
    <StoreProvider store={store}>
      <TrackEnabledSync />
      <Router>
        <div className="wz-app">
          <Rail />
          <Routes>
            <Route path="/play" element={<Play />} />
            <Route path="/publish" element={<Publish />} />
            <Route path="/" element={<Navigate to="/publish" replace />} />
          </Routes>
        </div>
      </Router>
    </StoreProvider>
  );
}

export default App;
