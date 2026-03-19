const CATEGORY_TREE = [
  {
    name: "Local",
    children: [
      { name: "India" },
      { name: "Singapore" },
      { name: "UAE" },
      { name: "Turkey" },
      { name: "Egypt" },
      { name: "Malta" },
      { name: "Spain" },
      { name: "Netherlands (Rotterdam)" },
      { name: "Denmark (Skagen)" },
      { name: "Baltic" },
      { name: "China" },
    ],
  },
  { name: "Paint" },
  { name: "Lub oil" },
  { name: "Chemicals and welding" },
  {
    name: "Spare Parts",
    children: [
      { name: "For Japan makers" },
      { name: "Engines" },
      { name: "Diesel Engines" },
      { name: "Separators and FWG" },
      {
        name: "Compressors and pumps",
        children: [
          { name: "Refrigeration compressors" },
          { name: "Air compressors" },
          { name: "Pumps" },
        ],
      },
      { name: "Turbocharges" },
      { name: "Boilers, incinerator and IGS" },
      { name: "Plate heat exchangers" },
      { name: "Electrical motors" },
      { name: "Filters" },
      { name: "Electrical parts" },
      { name: "Hydraulic" },
      {
        name: "Additional",
        children: [{ name: "Korea" }, { name: "China" }, { name: "India" }],
      },
    ],
  },
];

module.exports = {
  CATEGORY_TREE,
};
