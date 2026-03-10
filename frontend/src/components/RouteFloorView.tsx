import type { RouteFloor, RouteNode } from "../types";

type RouteFloorViewProps = {
  floor: RouteFloor;
  nodes: RouteNode[];
};

export const RouteFloorView = ({ floor, nodes }: RouteFloorViewProps) => {
  if (nodes.length === 0) {
    return <p className="muted">Keine Wegpunkte auf dieser Etage.</p>;
  }

  const polylinePoints = nodes.map((node) => `${node.x},${node.y}`).join(" ");

  return (
    <svg
      className="route-map"
      viewBox={`0 0 ${floor.width} ${floor.height}`}
      role="img"
      aria-label={`Routenansicht ${floor.label}`}
    >
      {floor.imageUrl ? (
        <image
          href={floor.imageUrl}
          x={0}
          y={0}
          width={floor.width}
          height={floor.height}
          preserveAspectRatio="xMidYMid meet"
        />
      ) : null}

      <polyline
        points={polylinePoints}
        fill="none"
        stroke="#1d6c8f"
        strokeWidth={12}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {nodes.map((node, index) => {
        let fill = "#2d7ea4";
        if (index === 0) {
          fill = "#2e8f4a";
        } else if (index === nodes.length - 1) {
          fill = "#bb2f3f";
        }
        return <circle key={node.id} cx={node.x} cy={node.y} r={12} fill={fill} />;
      })}
    </svg>
  );
};
