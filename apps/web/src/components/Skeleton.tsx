type SkeletonProps = {
  width?: string;
  height?: string;
  radius?: string;
};

/** Placeholder com shimmer exibido enquanto os dados carregam. */
export function Skeleton({ width = '100%', height = '1rem', radius }: SkeletonProps) {
  return (
    <span
      className="skeleton"
      style={{ width, height, ...(radius ? { borderRadius: radius } : {}) }}
      aria-hidden="true"
    />
  );
}
