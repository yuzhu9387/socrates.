// Classification belongs to the card instance, so one source note can appear
// in different visual categories without changing its words or tags.
export const CARD_COLORS = Object.freeze([
  { id: 'paper', label: 'Paper', background: '#FFFFFF', border: '#D8D8D8', accent: '#707070' },
  { id: 'sage', label: 'Sage', background: '#EDF1EB', border: '#CAD5C6', accent: '#586E54' },
  { id: 'sand', label: 'Sand', background: '#F3EFE7', border: '#DCD2BE', accent: '#7C694A' },
  { id: 'clay', label: 'Clay', background: '#F2EAE6', border: '#DCCAC1', accent: '#865F51' },
  { id: 'slate', label: 'Slate', background: '#EAF0F3', border: '#C5D3DC', accent: '#526E7F' },
  { id: 'lilac', label: 'Lilac', background: '#EEEAF1', border: '#D3C8DC', accent: '#725F83' },
].map(Object.freeze));

export function getCardColor(id) {
  return CARD_COLORS.find(color => color.id === id) || CARD_COLORS[0];
}
