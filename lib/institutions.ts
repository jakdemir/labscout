export const NYC_INSTITUTIONS: Record<string, string> = {
  "https://openalex.org/I78577930": "Columbia",
  "https://openalex.org/I57206974": "NYU",
  "https://openalex.org/I205783295": "Cornell",
  "https://openalex.org/I4405261073": "Cornell Tech",
};

/** Campus families for fair-share quotas: Cornell Tech is a second OpenAlex id for the same university,
 *  so without this Cornell gets two fetch slices and twice the shortlist seats of NYU or Columbia. */
export const FAMILY: Record<string, string> = { "Cornell Tech": "Cornell" };
export const familyOf = (inst: string) => FAMILY[inst] ?? inst;

export const INSTITUTION_FILTER = Object.keys(NYC_INSTITUTIONS)
  .map((u) => u.replace("https://openalex.org/", ""))
  .join("|");
