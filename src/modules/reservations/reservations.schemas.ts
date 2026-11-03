import { z } from "zod";
import { ReservationStatus } from "../../generated/prisma/enums.js";
import { optionalText } from "../../shared/validation/optional-text.js";
import { occupantInputSchema } from "../occupants/occupant-input.js";

/** Calendar date as `YYYY-MM-DD`. ISO dates compare correctly as plain strings. */
const date = z.iso.date();
const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const createReservationSchema = z
  .object({
    propertyId: z.uuid(),
    checkIn: date,
    checkOut: date,
    totalAmountCents: cents.default(0),
    notes: optionalText(z.string().trim().max(10_000)),
    /** Optional short-stay contract of the same property. */
    contractId: z.uuid().nullish(),
    /** The guest: an existing occupant... */
    occupantId: z.uuid().optional(),
    /** ...or a new one (an existing occupant with the same document is reused). */
    occupant: occupantInputSchema.optional(),
  })
  .superRefine((input, context) => {
    if ((input.occupantId === undefined) === (input.occupant === undefined)) {
      context.addIssue({ code: "custom", path: ["occupantId"], message: "Send either occupantId or occupant" });
    }
    if (input.checkOut <= input.checkIn) {
      context.addIssue({ code: "custom", path: ["checkOut"], message: "Check-out must be after check-in" });
    }
  });

/** Only confirmed reservations can be edited; the property and the guest are fixed. */
export const updateReservationSchema = z
  .object({
    checkIn: date,
    checkOut: date,
    totalAmountCents: cents,
    notes: optionalText(z.string().trim().max(10_000)),
    contractId: z.uuid().nullable(),
  })
  .partial()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: "Send at least one field to update",
  });

export const listReservationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  propertyId: z.uuid().optional(),
  contractId: z.uuid().optional(),
  status: z.enum(ReservationStatus).optional(),
  /** Reservations overlapping the window [from, to): handy for a calendar view. */
  from: date.optional(),
  to: date.optional(),
});

export const reservationIdParamSchema = z.object({ id: z.uuid() });

export type CreateReservationInput = z.output<typeof createReservationSchema>;
export type UpdateReservationInput = z.output<typeof updateReservationSchema>;
export type ListReservationsInput = z.output<typeof listReservationsQuerySchema>;
