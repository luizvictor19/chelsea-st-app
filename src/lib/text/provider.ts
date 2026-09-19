/**
 * Text completion behind one interface, the same shape the image provider
 * uses and for the same reason: the code that asks a question should not know
 * which company answers it, so swapping the model touches one file.
 */

export interface TextProvider {
  complete(input: {
    system: string;
    user: string;
    json: true;
  }): Promise<{ text: string; model: string }>;
}
