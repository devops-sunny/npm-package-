import React from 'react';

export interface MyButtonProps {
  label: string;
  onClick?: () => void;
}

export const MyButton: React.FC<MyButtonProps> = ({ label, onClick }) => {
  return (
    <button
      onClick={onClick}
      style={{
        background: '#6200EE',
        color: 'white',
        padding: '10px 20px',
        border: 'none',
        borderRadius: '5px',
        cursor: 'pointer'
      }}
    >
      {label}
    </button>
  );
};