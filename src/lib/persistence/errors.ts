import { Prisma } from "@prisma/client";

/** The deployed app may briefly run before an additive migration lands. */
export function isPersistenceModelUnavailable(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2021" || error.code === "P2022")
  );
}
