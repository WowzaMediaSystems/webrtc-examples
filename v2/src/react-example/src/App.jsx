import React from 'react';
import {
  HashRouter as Router,
  Routes,
  Route,
  Navigate
} from "react-router-dom";
import { Provider as StoreProvider } from "react-redux";

import store from './store'

import Nav from './components/shell/Nav';
import Errors from './components/shell/Errors';
import Play from './components/play/Play';
import Publish from './components/publish/Publish';
import 'bootstrap/dist/css/bootstrap.css';
import './App.css';

const App = () => {

  return (
    <StoreProvider store={store}>
      <Router>
        <div className="container-fluid">
          <Nav />
          <Errors />
        </div>
        <Routes>
          <Route path="/play" element={<Play />} />
          <Route path="/publish" element={<Publish />} />
          <Route path="/" element={<Navigate to="/publish" replace />} />
        </Routes>
      </Router>
    </StoreProvider>
  );
}

export default App;
