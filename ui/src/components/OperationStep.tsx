import React, { useState } from 'react';

interface OperationStepProps {
  stepNumber: number;
  title: string;
  subtitle: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  badge?: string;
}

export const OperationStep: React.FC<OperationStepProps> = ({
  stepNumber,
  title,
  subtitle,
  children,
  defaultOpen = true,
  badge,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={`card operation-card ${isOpen ? 'step-open' : 'step-closed'}`}>
      <div className="card-header step-toggle" onClick={() => setIsOpen(!isOpen)}>
        <span className="step-num">{stepNumber}</span>
        <div className="card-title">
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        {badge && <span className="step-badge">{badge}</span>}
        <span className={`step-chevron ${isOpen ? 'open' : ''}`}>▾</span>
      </div>
      {isOpen && <div className="card-body-step">{children}</div>}
    </div>
  );
};
