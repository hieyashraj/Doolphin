import { prisma } from "../prisma";
import { CreditEscrowService } from "../billing/CreditEscrowService";

export const UserService = {
  async getCredits(userId) {
    const workspace = await CreditEscrowService.ensureUserWorkspace(userId);
    if (!workspace?.creditAccount) throw new Error("Workspace credit account is unavailable");
    return workspace.creditAccount.availableCredits;
  },

  async addCredits(userId, amount) {
    if (amount <= 0) return null;
    const workspace = await CreditEscrowService.ensureUserWorkspace(userId);
    return prisma.creditAccount.update({ where: { id: workspace.creditAccount.id }, data: { availableCredits: { increment: amount }, lifetimeIssuedCredits: { increment: amount } } });
  },

  async deductCredits(userId, amount) {
    if (amount <= 0) return null;
    const workspace = await CreditEscrowService.ensureUserWorkspace(userId);
    if (workspace.creditAccount.availableCredits < amount) throw new Error("Insufficient credits available");
    return prisma.creditAccount.update({ where: { id: workspace.creditAccount.id }, data: { availableCredits: { decrement: amount } } });
  }
};

export const getCredits = UserService.getCredits.bind(UserService);
export const addCredits = UserService.addCredits.bind(UserService);
export const deductCredits = UserService.deductCredits.bind(UserService);
export default UserService;
