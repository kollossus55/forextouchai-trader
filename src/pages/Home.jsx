import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPageUrl } from '@/utils';

export default function Home() {
  const navigate = useNavigate();
  
  useEffect(() => {
    navigate(createPageUrl('Overview'));
  }, [navigate]);

  return <div className="text-slate-500 p-8 text-center">Redirecting to dashboard...</div>;
}