// Relative, with the extension: suggest-flow.ts imports this under node.
import {
  MAX_PAIRS,
  MIN_PAIRS,
} from "../../../../lib/questions/suggest-questions.ts";

/**
 * The refusals of Sugerir perguntas that the screen also says before asking
 * (#231). Apart from suggest-flow.ts, which the browser must not load: it
 * brings the model's SDK with it.
 */
export const COUNT_RANGE = `Escolha de ${MIN_PAIRS} a ${MAX_PAIRS} perguntas.`;
export const NO_NEW_WORDS = "Este ponto não tem palavras novas para perguntar.";
