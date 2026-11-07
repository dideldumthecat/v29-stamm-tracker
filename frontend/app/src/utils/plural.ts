/** The count with the singular or plural wording: "1 Foto bleibt", "3 Fotos bleiben". */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}
