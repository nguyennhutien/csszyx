import React from 'react';
import ReactDOM from 'react-dom';

import App from './App.tsx';
import './index.css';

// React 17 mounts with ReactDOM.render — NOT createRoot (that is the React 18
// react-dom/client API). This is the defining runtime difference the smoke
// test exercises.
ReactDOM.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
  document.getElementById('root'),
);
