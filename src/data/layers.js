// Map layers the reader can switch on and off, from the Layers button on the map.
// Everything else on the map is always drawn.
//
// To add a layer: add a line here, then draw it in MapView when state.layers.<id> is on.
export const LAYERS = [
  { id: 'heatmap', label: 'Unmet need heatmap', on: false },
];
