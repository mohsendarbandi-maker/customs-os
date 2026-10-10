import React from 'react';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import type { ShipmentCostStage } from './shipmentCosts';

type Props = { stage: ShipmentCostStage; shipmentId?: string; shipment?: { id?: string | null } | null };

const COST_ENTRY_ROLES = ['owner', 'admin', 'broker', 'accountant', 'warehouse'];

export const ShipmentStageCosts: React.FC<Props> = ({ stage, shipmentId, shipment }) => {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const id = shipment?.id || shipmentId;

  if (!id || !profile || !COST_ENTRY_ROLES.includes(profile.role)) return null;

  const openCostEntry = () => {
    const query = new URLSearchParams({ stage, new: '1' });
    navigate(`/finance/shipments/${encodeURIComponent(id)}?${query.toString()}`);
  };

  return (
    <button
      type="button"
      onClick={openCostEntry}
      aria-label="ثبت هزینه برای این مرحله"
      title="ثبت هزینه برای این مرحله"
      className="inline-flex items-center gap-1.5 rounded-lg border app-border px-3 py-2 text-xs font-bold app-muted transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
    >
      <Plus size={14} aria-hidden="true" />
      ثبت هزینه
    </button>
  );
};
