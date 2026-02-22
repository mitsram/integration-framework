import type { Config } from "@jest/types";

const config: Config.InitialOptions = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests/contract"],
  testMatch: ["**/*.pact.spec.ts"],
  moduleNameMapper: {
    "^@clients/(.*)$": "<rootDir>/src/clients/$1",
    "^@schemas/(.*)$": "<rootDir>/src/schemas/$1",
    "^@utils/(.*)$": "<rootDir>/src/utils/$1",
  },
  reporters: [
    "default",
    [
      "jest-junit",
      {
        outputDirectory: "reports",
        outputName: "pact-junit-results.xml",
      },
    ],
  ],
};

export default config;
