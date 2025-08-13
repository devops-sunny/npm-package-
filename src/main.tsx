import React from 'react';
import ReactDOM from 'react-dom/client';
import { MyButton } from './index';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MyButton label="Click Me" onClick={() => alert('Button clicked!')} />
  </React.StrictMode>
);