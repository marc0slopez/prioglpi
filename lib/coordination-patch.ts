export interface CoordinationPatch {
  progressPercent?: number;
  estimatedDeliveryDate?: string | null;
  coordinatorComment?: string;
  commentIsPrivate?: boolean;
}

export function buildCoordinationPatch(
  previous: { progressPercent: number; estimatedDeliveryDate: string | null } | null,
  edited: { progressPercent: number; estimatedDeliveryDate: string; coordinatorComment: string; commentIsPrivate: boolean },
  commentTouched: boolean
): CoordinationPatch {
  const patch: CoordinationPatch = {};
  if (edited.progressPercent !== (previous?.progressPercent ?? 0)) {
    patch.progressPercent = edited.progressPercent;
  }
  if (edited.estimatedDeliveryDate !== (previous?.estimatedDeliveryDate ?? '')) {
    patch.estimatedDeliveryDate = edited.estimatedDeliveryDate || null;
  }
  if (commentTouched) {
    patch.coordinatorComment = edited.coordinatorComment;
    patch.commentIsPrivate = edited.commentIsPrivate;
  }
  return patch;
}
