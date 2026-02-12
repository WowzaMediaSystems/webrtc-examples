import React from 'react';
import {
  BrowserRouter as Router,
  Switch,
  Route,
  Redirect
} from "react-router-dom";
import { Provider as StoreProvider } from "react-redux";

import store from './store'

import Nav from './components/shell/Nav';
import Errors from './components/shell/Errors';
import Composite from './components/composite/Composite';
import Play from './components/play/Play';
import Publish from './components/publish/Publish';
import Meeting from './components/meeting/Meeting';
import CompositorUserMedia from './components/media/CompositorUserMedia';
import Devices from './components/media/Devices';
import 'bootstrap/dist/css/bootstrap.css';
import './App.css';

const App = () => {

  let buildComponent = 'develop';
  if (process.env.REACT_APP_BASENAME != null && process.env.REACT_APP_BASENAME.indexOf('composite') > 0)
    buildComponent = 'composite';
  else if (process.env.REACT_APP_BASENAME != null && process.env.REACT_APP_BASENAME.indexOf('meeting') > 0)
    buildComponent = 'meeting';

  return (
    <StoreProvider store={store}>
      <CompositorUserMedia />
      <Devices />
      <Router basename={process.env.REACT_APP_BASENAME}>
        <div className="container-fluid">
          <Nav buildComponent={ buildComponent }/>
          <Errors />
        </div>
        <Switch>
          {buildComponent === 'develop' && (
            <>
              <Switch>
                <Route exact path="/play" component={Play} />
                <Route exact path="/meeting" component={Meeting} />
                <Route exact path="/composite" component={Composite} />
                <Route exact path="/publish" component={Publish} />
                <Redirect exact from="/" to="/publish" />
              </Switch>
            </>
          )}
          { buildComponent === 'composite' && (
            <Route path="/">
              <Composite />
            </Route>
          )}
          { buildComponent === 'meeting' && (
            <Route path="/">
              <Meeting />
            </Route>
          )}
        </Switch>
      </Router>
    </StoreProvider>
  );
}

export default App;
