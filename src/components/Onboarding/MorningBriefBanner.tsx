import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sun, ArrowRight, X, ClipboardList, HeartHandshake, Cpu } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { isHandoffPending, setHandoffPending } from '../../utils/wizard';
import './MorningBriefBanner.css';

interface BriefTask {
  id: string;
  icon: React.ElementType;
  text: string;
  ctaLabel: string;
  path: string;
}

const TASKS: BriefTask[] = [
  { id: 't-program',  icon: ClipboardList, text: 'Add a few more beneficiaries to flesh out your first program.', ctaLabel: 'Open Programs',  path: '/programs' },
  { id: 't-donor',    icon: HeartHandshake,text: 'Log your first donor — even a friend or family member counts.',   ctaLabel: 'Add donor',      path: '/funding'  },
  { id: 't-copilot',  icon: Cpu,           text: 'Ask the AI Copilot to draft your first funder update.',           ctaLabel: 'Try Copilot',    path: '/agent-hq' },
];

/**
 * One-shot welcome banner shown on Today right after wizard exit.
 * Dismissed automatically once user clicks the X or any of the 3 task CTAs.
 */
const MorningBriefBanner: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (user?.id && isHandoffPending(user.id)) setShow(true);
  }, [user?.id]);

  if (!user || !show) return null;

  const dismiss = () => {
    setHandoffPending(user.id, false);
    setShow(false);
  };

  const followCta = (path: string) => {
    dismiss();
    navigate(path);
  };

  return (
    <div className="morning-brief-banner" role="region" aria-labelledby="brief-title">
      <div className="morning-brief-burst"><Sun size={26} /></div>
      <div className="morning-brief-body">
        <h2 id="brief-title">Welcome to GoodJobs, {user.name.split(' ')[0]}!</h2>
        <p>Here's where to start today — three quick wins to feel the system working for you.</p>
        <ul className="morning-brief-tasks">
          {TASKS.map((task) => {
            const Icon = task.icon;
            return (
              <li key={task.id}>
                <Icon size={16} className="morning-brief-task-icon" />
                <span className="morning-brief-task-text">{task.text}</span>
                <button className="morning-brief-task-cta" onClick={() => followCta(task.path)}>
                  {task.ctaLabel} <ArrowRight size={12} />
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <button className="morning-brief-dismiss" onClick={dismiss} aria-label="Dismiss morning brief">
        <X size={16} />
      </button>
    </div>
  );
};

export default MorningBriefBanner;
