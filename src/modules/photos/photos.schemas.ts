import { z } from "zod";

export const uploadPhotoSchema = z.object({
  file: z.instanceof(File, { message: "Send the image in a multipart field named \"file\"" }),
});

/** Every photo of the property, once, in the wanted order. */
export const reorderPhotosSchema = z.object({
  photoIds: z.array(z.uuid()).min(1).max(100),
});

export const propertyParamSchema = z.object({ propertyId: z.uuid() });
export const photoParamsSchema = z.object({ propertyId: z.uuid(), id: z.uuid() });
