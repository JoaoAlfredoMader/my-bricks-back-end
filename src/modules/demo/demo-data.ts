import type {
  AcquisitionType,
  AdjustmentIndex,
  AmortizationSystem,
  ConservationState,
  ContractStatus,
  ContractType,
  PropertyType,
  ProposalType,
  RegistrationStatus,
  RentalMode,
  ReservationStatus,
  UsageType,
} from "../../generated/prisma/enums.js";

/**
 * The sample portfolio a guest gets to play with. It is built from "today", so there is always a
 * contract about to end, a reservation coming up and an expense this month. Money is in cents.
 * Everything here is made up: names, documents and addresses are fictional.
 */

export interface DemoClient { key: string; name: string; personType: "individual" | "company"; document: string; email: string; whatsapp: string }
export interface DemoAgency { key: string; name: string }
export interface DemoOccupant { key: string; name: string; document: string | null; email: string | null; phone: string | null }

export interface DemoProperty {
  key: string;
  name: string;
  propertyType: PropertyType;
  subtype: string;
  usageType: UsageType;
  rentalMode: RentalMode;
  clientKey?: string;
  agencyKey?: string;
  ownershipPercentage: number;
  totalArea?: number;
  privateArea?: number;
  bedrooms?: number;
  bathrooms?: number;
  parkingSpaces?: number;
  parkingSpotLabel?: string;
  builtYear?: number;
  conservationState?: ConservationState;
  estimatedValueCents: number;
  annualExpensesCents: number;
  occupancyRate: number;
  notes?: string;
  address: { city: string; state: string; postalCode: string; street: string; number: string; complement?: string; neighborhood: string };
  manualRental?: { tenantName: string | null; monthlyRentCents: number; dueDay: number };
  acquisition?: { acquisitionType: AcquisitionType; acquiredOn: Date; costCents: number };
  financing?: { lender: string; financedAmountCents: number; termMonths: number; annualInterestRate: number; amortizationSystem: AmortizationSystem; firstInstallmentOn: Date };
  legalRecord?: { registrationStatus: RegistrationStatus; irregularityDescription?: string; registryNumber: string; registryOffice: string };
  insurance?: { description: string };
}

export interface DemoContract {
  key: string;
  propertyKey: string;
  occupantKey: string;
  contractType: ContractType;
  status: ContractStatus;
  startDate: Date;
  endDate: Date | null;
  rentTerms?: { monthlyRentCents: number; dueDay: number; adjustmentIndex: AdjustmentIndex };
  notes?: string;
}

export interface DemoReservation {
  propertyKey: string;
  contractKey: string;
  occupantKey: string;
  checkIn: Date;
  checkOut: Date;
  totalAmountCents: number;
  status: ReservationStatus;
}

export interface DemoTransaction {
  propertyKey: string;
  category: { type: "revenue" | "expense"; name: string };
  amountCents: number;
  occurredOn: Date;
  description: string;
  isRecurring: boolean;
  recurrenceEndsOn?: Date;
}

export interface DemoProposal {
  propertyKey: string;
  proposalType: ProposalType;
  amountCents: number;
  proposalDate: Date;
  contact: string;
  notes?: string;
}

export interface DemoPlan {
  agencies: DemoAgency[];
  clients: DemoClient[];
  occupants: DemoOccupant[];
  properties: DemoProperty[];
  contracts: DemoContract[];
  reservations: DemoReservation[];
  transactions: DemoTransaction[];
  proposals: DemoProposal[];
}

/** A valid-looking CPF from nine digits (the two check digits are computed). */
export function fakeCpf(base: string): string {
  const digits = base.split("").map(Number);
  const check = (length: number) => {
    const sum = digits.slice(0, length).reduce((acc, digit, index) => acc + digit * (length + 1 - index), 0);
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };
  digits.push(check(9));
  digits.push(check(10));
  return digits.join("");
}

/** A valid-looking CNPJ from twelve digits. */
export function fakeCnpj(base: string): string {
  const digits = base.split("").map(Number);
  const weights = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const check = (length: number) => {
    const sum = digits.slice(0, length).reduce((acc, digit, index) => acc + digit * weights[weights.length - length + index]!, 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  digits.push(check(12));
  digits.push(check(13));
  return digits.join("");
}

/** Builds the sample portfolio around `today` (a calendar day at UTC midnight). */
export function buildDemoPlan(today: Date): DemoPlan {
  const day = (offset: number) => new Date(today.getTime() + offset * 86_400_000);

  const clients: DemoClient[] = [
    { key: "maria", name: "Maria Oliveira", personType: "individual", document: fakeCpf("529982247"), email: "maria.oliveira@exemplo.com.br", whatsapp: "11987654321" },
    { key: "horizonte", name: "Construtora Horizonte Ltda", personType: "company", document: fakeCnpj("112223330001"), email: "contato@horizonte.exemplo.com.br", whatsapp: "1133445566" },
    { key: "joao", name: "João Pereira", personType: "individual", document: fakeCpf("168995350"), email: "joao.pereira@exemplo.com.br", whatsapp: "19991234567" },
  ];

  const occupants: DemoOccupant[] = [
    { key: "pedro", name: "Pedro Almeida", document: fakeCpf("111444777"), email: "pedro.almeida@exemplo.com.br", phone: "11976543210" },
    { key: "ana", name: "Ana Carolina Souza", document: fakeCpf("390533447"), email: "ana.souza@exemplo.com.br", phone: "11965432109" },
    { key: "lucas", name: "Lucas Ferreira", document: fakeCpf("123456789"), email: "lucas.ferreira@exemplo.com.br", phone: "19954321098" },
    { key: "clinica", name: "Clínica Bem-Estar Ltda", document: fakeCnpj("445556660001"), email: "adm@bemestar.exemplo.com.br", phone: "1134567890" },
    { key: "temporada", name: "Temporada Santos Administração", document: fakeCnpj("778889990001"), email: "reservas@temporadasantos.exemplo.com.br", phone: "1332211000" },
    { key: "g1", name: "Carla Mendes", document: null, email: "carla.mendes@exemplo.com.br", phone: "21988776655" },
    { key: "g2", name: "Roberto Lima", document: null, email: null, phone: "31977665544" },
    { key: "g3", name: "Fernanda Costa", document: null, email: "fernanda.costa@exemplo.com.br", phone: null },
    { key: "g4", name: "Thiago Barbosa", document: null, email: "thiago.barbosa@exemplo.com.br", phone: "41966554433" },
    { key: "g5", name: "Juliana Rocha", document: null, email: null, phone: "51955443322" },
    { key: "g6", name: "Marcos Vieira", document: null, email: "marcos.vieira@exemplo.com.br", phone: "61944332211" },
  ];

  const properties: DemoProperty[] = [
    {
      key: "centro", name: "Apartamento Centro", propertyType: "residential", subtype: "Apartamento", usageType: "rental", rentalMode: "contract",
      clientKey: "maria", agencyKey: "central", ownershipPercentage: 100, totalArea: 78, privateArea: 65, bedrooms: 2, bathrooms: 2, parkingSpaces: 1, builtYear: 2012, conservationState: "good",
      estimatedValueCents: 68_000_000, annualExpensesCents: 540_000, occupancyRate: 95,
      notes: "Próximo ao metrô. Contrato com reajuste anual pelo IGP-M.",
      address: { city: "São Paulo", state: "SP", postalCode: "01310-100", street: "Avenida Paulista", number: "1500", complement: "apto 82", neighborhood: "Bela Vista" },
      acquisition: { acquisitionType: "purchase", acquiredOn: day(-2000), costCents: 52_000_000 },
      financing: { lender: "Caixa Econômica Federal", financedAmountCents: 36_000_000, termMonths: 360, annualInterestRate: 9.5, amortizationSystem: "sac", firstInstallmentOn: day(-1970) },
      legalRecord: { registrationStatus: "regular", registryNumber: "123.456", registryOffice: "4º Cartório de Registro de Imóveis de São Paulo" },
      insurance: { description: "Apólice residencial 8841-22, Porto Seguro, renovação anual" },
    },
    {
      key: "kitnet", name: "Kitnet Universitária", propertyType: "residential", subtype: "Apartamento", usageType: "rental", rentalMode: "manual",
      clientKey: "joao", ownershipPercentage: 100, totalArea: 28, privateArea: 28, bedrooms: 1, bathrooms: 1, builtYear: 2005, conservationState: "regular",
      estimatedValueCents: 22_000_000, annualExpensesCents: 180_000, occupancyRate: 90,
      address: { city: "Campinas", state: "SP", postalCode: "13083-852", street: "Rua Albert Sabin", number: "340", complement: "kitnet 4", neighborhood: "Cidade Universitária" },
      manualRental: { tenantName: "Lucas Ferreira", monthlyRentCents: 165_000, dueDay: 10 },
      acquisition: { acquisitionType: "purchase", acquiredOn: day(-1400), costCents: 15_000_000 },
    },
    {
      key: "flat", name: "Flat Beira-Mar", propertyType: "residential", subtype: "Apartamento", usageType: "short_stay", rentalMode: "contract",
      clientKey: "maria", agencyKey: "central", ownershipPercentage: 100, totalArea: 42, privateArea: 38, bedrooms: 1, bathrooms: 1, parkingSpaces: 1, builtYear: 2018, conservationState: "excellent",
      estimatedValueCents: 45_000_000, annualExpensesCents: 600_000, occupancyRate: 70,
      notes: "Temporada administrada em plataforma de reservas.",
      address: { city: "Santos", state: "SP", postalCode: "11055-300", street: "Avenida Presidente Wilson", number: "220", complement: "apto 1204", neighborhood: "Gonzaga" },
      acquisition: { acquisitionType: "purchase", acquiredOn: day(-900), costCents: 38_000_000 },
      insurance: { description: "Seguro condomínio e conteúdo, Tokio Marine" },
    },
    {
      key: "sala", name: "Sala Comercial Paulista", propertyType: "commercial", subtype: "Sala comercial", usageType: "rental", rentalMode: "contract",
      clientKey: "horizonte", ownershipPercentage: 100, totalArea: 55, privateArea: 50, bathrooms: 1, parkingSpaces: 2, builtYear: 2015, conservationState: "good",
      estimatedValueCents: 120_000_000, annualExpensesCents: 1_200_000, occupancyRate: 100,
      address: { city: "São Paulo", state: "SP", postalCode: "01311-000", street: "Avenida Paulista", number: "1000", complement: "conj. 1203", neighborhood: "Bela Vista" },
      acquisition: { acquisitionType: "construction", acquiredOn: day(-1600), costCents: 80_000_000 },
      legalRecord: { registrationStatus: "regular", registryNumber: "98.765", registryOffice: "5º Cartório de Registro de Imóveis de São Paulo" },
    },
    {
      key: "galpao", name: "Galpão Logístico Anhanguera", propertyType: "logistics", subtype: "Galpão logístico", usageType: "rental", rentalMode: "manual",
      clientKey: "horizonte", ownershipPercentage: 100, totalArea: 2400, privateArea: 2200, builtYear: 2010, conservationState: "regular",
      estimatedValueCents: 280_000_000, annualExpensesCents: 3_000_000, occupancyRate: 100,
      address: { city: "Campinas", state: "SP", postalCode: "13069-120", street: "Rodovia Anhanguera", number: "km 98", neighborhood: "Distrito Industrial" },
      manualRental: { tenantName: "Transportes Rápido Ltda", monthlyRentCents: 1_850_000, dueDay: 5 },
      acquisition: { acquisitionType: "purchase", acquiredOn: day(-2500), costCents: 210_000_000 },
      legalRecord: { registrationStatus: "irregular", irregularityDescription: "Habite-se da ampliação ainda pendente na prefeitura.", registryNumber: "45.210", registryOffice: "1º Cartório de Registro de Imóveis de Campinas" },
    },
    {
      key: "terreno", name: "Terreno Atibaia", propertyType: "land", subtype: "Terreno", usageType: "own_use", rentalMode: "manual",
      clientKey: "joao", ownershipPercentage: 100, totalArea: 1000,
      estimatedValueCents: 18_000_000, annualExpensesCents: 120_000, occupancyRate: 90,
      notes: "Herança da família. Aguardando projeto para construir.",
      address: { city: "Atibaia", state: "SP", postalCode: "12940-000", street: "Estrada do Itapetinga", number: "s/n", neighborhood: "Jardim dos Pinheiros" },
      acquisition: { acquisitionType: "inheritance", acquiredOn: day(-3000), costCents: 9_000_000 },
    },
    {
      key: "praia", name: "Casa de Praia", propertyType: "residential", subtype: "Casa", usageType: "own_use", rentalMode: "manual",
      ownershipPercentage: 50, totalArea: 220, privateArea: 140, bedrooms: 4, bathrooms: 3, parkingSpaces: 3, builtYear: 2008, conservationState: "good",
      estimatedValueCents: 95_000_000, annualExpensesCents: 800_000, occupancyRate: 90,
      notes: "Dividida meio a meio com o irmão.",
      address: { city: "Florianópolis", state: "SC", postalCode: "88058-000", street: "Rua das Gaivotas", number: "77", neighborhood: "Ingleses" },
      acquisition: { acquisitionType: "purchase", acquiredOn: day(-2800), costCents: 60_000_000 },
    },
    {
      key: "vaga", name: "Vaga de Garagem 12", propertyType: "parking", subtype: "Vaga coberta", usageType: "rental", rentalMode: "manual",
      clientKey: "maria", ownershipPercentage: 100, parkingSpotLabel: "B-12",
      estimatedValueCents: 4_500_000, annualExpensesCents: 24_000, occupancyRate: 100,
      address: { city: "São Paulo", state: "SP", postalCode: "01310-200", street: "Alameda Santos", number: "800", neighborhood: "Cerqueira César" },
      manualRental: { tenantName: "Ana Carolina Souza", monthlyRentCents: 28_000, dueDay: 8 },
      acquisition: { acquisitionType: "purchase", acquiredOn: day(-700), costCents: 3_800_000 },
    },
    {
      key: "vila", name: "Apartamento Vila Mariana", propertyType: "residential", subtype: "Apartamento", usageType: "rental", rentalMode: "manual",
      agencyKey: "central", ownershipPercentage: 100, totalArea: 62, privateArea: 54, bedrooms: 2, bathrooms: 1, parkingSpaces: 1, builtYear: 1998, conservationState: "regular",
      estimatedValueCents: 52_000_000, annualExpensesCents: 420_000, occupancyRate: 90,
      notes: "Recém-desocupado, em pintura. Pronto para anunciar.",
      address: { city: "São Paulo", state: "SP", postalCode: "04101-000", street: "Rua Domingos de Morais", number: "2000", complement: "apto 31", neighborhood: "Vila Mariana" },
      acquisition: { acquisitionType: "purchase", acquiredOn: day(-1100), costCents: 41_000_000 },
    },
  ];

  const contracts: DemoContract[] = [
    { key: "centro-antigo", propertyKey: "centro", occupantKey: "pedro", contractType: "conventional", status: "ended", startDate: day(-700), endDate: day(-301), rentTerms: { monthlyRentCents: 350_000, dueDay: 5, adjustmentIndex: "igpm" }, notes: "Encerrado no prazo." },
    { key: "centro", propertyKey: "centro", occupantKey: "ana", contractType: "conventional", status: "active", startDate: day(-300), endDate: day(65), rentTerms: { monthlyRentCents: 380_000, dueDay: 5, adjustmentIndex: "igpm" }, notes: "Vence em breve: avaliar renovação." },
    { key: "sala", propertyKey: "sala", occupantKey: "clinica", contractType: "conventional", status: "active", startDate: day(-150), endDate: null, rentTerms: { monthlyRentCents: 720_000, dueDay: 10, adjustmentIndex: "ipca" } },
    { key: "flat", propertyKey: "flat", occupantKey: "temporada", contractType: "short_stay", status: "active", startDate: day(-400), endDate: null, notes: "Contrato de administração de temporada." },
  ];

  const stay = (propertyGuest: string, checkInOffset: number, nights: number, total: number, status: ReservationStatus = "confirmed"): DemoReservation => ({
    propertyKey: "flat", contractKey: "flat", occupantKey: propertyGuest,
    checkIn: day(checkInOffset), checkOut: day(checkInOffset + nights), totalAmountCents: total, status,
  });
  const reservations: DemoReservation[] = [
    stay("g1", -300, 4, 160_000),
    stay("g2", -240, 5, 210_000),
    stay("g3", -170, 3, 135_000),
    stay("g4", -120, 6, 270_000),
    stay("g5", -70, 4, 180_000),
    stay("g6", -25, 5, 225_000),
    stay("g1", 18, 7, 330_000),
    stay("g2", -10, 3, 120_000, "cancelled"),
  ];

  const transactions: DemoTransaction[] = [
    { propertyKey: "centro", category: { type: "expense", name: "Parcela de financiamento" }, amountCents: 385_000, occurredOn: day(-1970), description: "Parcela mensal do financiamento (SAC)", isRecurring: true },
    { propertyKey: "centro", category: { type: "expense", name: "Reforma" }, amountCents: 1_200_000, occurredOn: day(-320), description: "Pintura e troca do piso entre inquilinos", isRecurring: false },
    { propertyKey: "sala", category: { type: "expense", name: "Honorários" }, amountCents: 350_000, occurredOn: day(-155), description: "Honorários da assessoria jurídica na assinatura do contrato", isRecurring: false },
    { propertyKey: "flat", category: { type: "revenue", name: "Indenização" }, amountCents: 500_000, occurredOn: day(-40), description: "Indenização por danos causados por hóspede", isRecurring: false },
    { propertyKey: "kitnet", category: { type: "expense", name: "Reforma" }, amountCents: 400_000, occurredOn: day(-60), description: "Troca do chuveiro e pintura", isRecurring: false },
    { propertyKey: "vila", category: { type: "expense", name: "Reforma" }, amountCents: 900_000, occurredOn: day(-12), description: "Pintura geral antes de anunciar", isRecurring: false },
  ];

  const proposals: DemoProposal[] = [
    { propertyKey: "centro", proposalType: "purchase", amountCents: 72_000_000, proposalDate: day(-20), contact: "Marcos Corretor (11) 98888-0000", notes: "Pagamento à vista; pediu 30 dias para a escritura." },
    { propertyKey: "terreno", proposalType: "sale", amountCents: 21_000_000, proposalDate: day(-45), contact: "Incorporadora Vale Verde", notes: "Querem fechar até o fim do trimestre." },
    { propertyKey: "vila", proposalType: "rental", amountCents: 280_000, proposalDate: day(-5), contact: "Imobiliária Central", notes: "Candidato com renda comprovada e fiador." },
  ];

  return {
    agencies: [{ key: "central", name: "Imobiliária Central" }],
    clients,
    occupants,
    properties,
    contracts,
    reservations,
    transactions,
    proposals,
  };
}
