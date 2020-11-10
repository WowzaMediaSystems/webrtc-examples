import React from 'react';
import { Link } from 'react-router-dom';
import wowzaLogo from '../../images/wowza-logo.svg'

const Nav = () => {

  return (
    <nav className="navbar navbar-expand-sm navbar-light bg-light pb-3 pb-md-2" id="top-nav">
      <a className="navbar-brand" href="https://www.wowza.com"><img className="noll"  src={wowzaLogo} alt="Wowza Media Systems" /></a>
      <ul className="navbar-nav mr-auto-lg">
        <li className="nav-item page">
          <a href="https://www.wowza.com/developer/webrtc/dev-view-publish">
            Publish
          </a>
          <span></span>
        </li>
        <li className="nav-item page">
          <a href="https://www.wowza.com/developer/webrtc/dev-view-play">
            Play
          </a>
          <span></span>
        </li>
        <li className="nav-item page">
          <Link to="/composite">
            Composite
          </Link>
          <span></span>
        </li>
        <li className="nav-item page">
          <Link to="/meeting">
            Meeting
          </Link>
          <span></span>
        </li>
      </ul>
      <ul className="navbar-nav ml-auto d-none d-md-flex">
        <li className="nav-item mr-3">
          <a href="https://www.wowza.com/docs/wowza-streaming-engine-product-articles">Docs</a>
        </li>
        <li className="nav-item mr-3">
          <a href="https://www.wowza.com/developer">Developer Portal</a>
        </li>
      </ul>
    </nav>
  );
}

export default Nav;
