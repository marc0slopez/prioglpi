export interface MetricsTechnician {
  id: number | 'unassigned' | null;
  name: string;
  count: number;
}
export function normalizeMetricsTechnician(entry: MetricsTechnician) {
  return { ...entry, id: entry.id === 'unassigned' ? null : entry.id };
}
export function setMetricsTechnicianFilter(params: URLSearchParams, technician: { id: number | null; name: string }) {
  params.delete('technicianId');
  params.delete('unassignedTechnician');
  params.delete('soporteDycos');
  if (technician.name === 'Soporte Dycos') params.set('soporteDycos', 'true');
  else if (technician.id === null) params.set('unassignedTechnician', 'true');
  else params.set('technicianId', String(technician.id));
}
