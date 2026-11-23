import { useEffect, useRef, useState } from 'react';
import { getRealtimeWsUrl } from '../lib/apiClient';
import type { BathymetryPoint, CatchReport } from '../lib/types';

interface UseRealtimeOptions {
  isOnline: boolean;
  onNewReport: (report: CatchReport) => void;
  onNewDepthPoint: (point: BathymetryPoint) => void;
}

export function useRealtimeReports({ isOnline, onNewReport, onNewDepthPoint }: UseRealtimeOptions) {
  const [connected, setConnected] = useState(false);
  const onNewReportRef = useRef(onNewReport);
  const onNewDepthRef = useRef(onNewDepthPoint);
  onNewReportRef.current = onNewReport;
  onNewDepthRef.current = onNewDepthPoint;

  useEffect(() => {
    const wsTarget = getRealtimeWsUrl();
    if (!isOnline || !wsTarget) {
      setConnected(false);
      return;
    }

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closedByUser = false;
    let retryMs = 1000;

    const connect = () => {
      if (closedByUser) return;
      ws = new WebSocket(wsTarget);

      ws.onopen = () => {
        setConnected(true);
        retryMs = 1000;
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data) as { type?: string; data?: unknown };
          if (msg.type === 'reports:new' && msg.data) {
            onNewReportRef.current(msg.data as CatchReport);
          } else if (msg.type === 'depth:new' && msg.data) {
            onNewDepthRef.current(msg.data as BathymetryPoint);
          }
        } catch {
          // Ignore invalid JSON
        }
      };

      ws.onclose = () => {
        setConnected(false);
        if (!closedByUser) {
          reconnectTimer = setTimeout(connect, retryMs);
          retryMs = Math.min(15000, retryMs * 2);
        }
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      closedByUser = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [isOnline]);

  return { wsConnected: connected };
}
