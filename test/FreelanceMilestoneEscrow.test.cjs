const { expect } = require("chai");
const { ethers, network } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const State = { AWAITING_PAYMENT: 0n, FUNDED: 1n, COMPLETED: 2n, REFUNDED: 3n };
const AMOUNT = ethers.parseEther("1");
const ZERO = ethers.ZeroAddress;

async function deployFixture() {
  const [client, freelancer, stranger] = await ethers.getSigners();
  const Escrow = await ethers.getContractFactory("FreelanceMilestoneEscrow");
  const escrow = await Escrow.connect(client).deploy(freelancer.address);
  return { escrow, Escrow, client, freelancer, stranger };
}

async function fundedFixture() {
  const f = await deployFixture();
  await f.escrow.connect(f.client).depositFunds({ value: AMOUNT });
  return f;
}

describe("FreelanceMilestoneEscrow", () => {
  describe("Constructor (U-01, U-02)", () => {
    it("U-01 reverts ZeroAddress when freelancer is address(0)", async () => {
      const { Escrow } = await loadFixture(deployFixture);
      await expect(Escrow.deploy(ZERO)).to.be.revertedWithCustomError(Escrow, "ZeroAddress");
    });

    it("U-02 sets client, freelancer and initial state", async () => {
      const { escrow, client, freelancer } = await loadFixture(deployFixture);
      expect(await escrow.client()).to.equal(client.address);
      expect(await escrow.freelancer()).to.equal(freelancer.address);
      expect(await escrow.state()).to.equal(State.AWAITING_PAYMENT);
    });

    it("permits client == freelancer (self-dealing) without revert", async () => {
      const { Escrow, client } = await loadFixture(deployFixture);
      const e = await Escrow.deploy(client.address);
      expect(await e.client()).to.equal(await e.freelancer());
    });
  });

  describe("depositFunds (U-03..U-06)", () => {
    it("U-03 reverts Unauthorized for non-client", async () => {
      const { escrow, freelancer, stranger } = await loadFixture(deployFixture);
      for (const s of [freelancer, stranger]) {
        await expect(escrow.connect(s).depositFunds({ value: AMOUNT })).to.be.revertedWithCustomError(escrow, "Unauthorized");
      }
    });

    it("U-04 reverts ZeroDeposit when value is 0", async () => {
      const { escrow, client } = await loadFixture(deployFixture);
      await expect(escrow.connect(client).depositFunds({ value: 0 })).to.be.revertedWithCustomError(escrow, "ZeroDeposit");
    });

    it("U-05 reverts InvalidState on repeat deposit", async () => {
      const { escrow, client } = await loadFixture(fundedFixture);
      await expect(escrow.connect(client).depositFunds({ value: AMOUNT })).to.be.revertedWithCustomError(escrow, "InvalidState");
    });

    it("U-06 success: FUNDED, balance updated, event emitted", async () => {
      const { escrow, client } = await loadFixture(deployFixture);
      await expect(escrow.connect(client).depositFunds({ value: AMOUNT }))
        .to.emit(escrow, "FundsDeposited")
        .withArgs(client.address, AMOUNT);
      expect(await escrow.state()).to.equal(State.FUNDED);
      expect(await ethers.provider.getBalance(escrow.target)).to.equal(AMOUNT);
    });
  });

  describe("releasePayment (U-07..U-10)", () => {
    it("U-07 reverts Unauthorized for non-client", async () => {
      const { escrow, freelancer, stranger } = await loadFixture(fundedFixture);
      for (const s of [freelancer, stranger]) {
        await expect(escrow.connect(s).releasePayment()).to.be.revertedWithCustomError(escrow, "Unauthorized");
      }
    });

    it("U-08 reverts InvalidState outside FUNDED (before funding, after completion)", async () => {
      const { escrow, client } = await loadFixture(deployFixture);
      await expect(escrow.connect(client).releasePayment()).to.be.revertedWithCustomError(escrow, "InvalidState");
      await escrow.connect(client).depositFunds({ value: AMOUNT });
      await escrow.connect(client).releasePayment();
      await expect(escrow.connect(client).releasePayment()).to.be.revertedWithCustomError(escrow, "InvalidState");
    });

    it("U-09 success: pays freelancer in full, COMPLETED, event emitted", async () => {
      const { escrow, client, freelancer } = await loadFixture(fundedFixture);
      const tx = escrow.connect(client).releasePayment();
      await expect(tx).to.emit(escrow, "PaymentReleased").withArgs(freelancer.address, AMOUNT);
      await expect(tx).to.changeEtherBalances([escrow, freelancer], [-AMOUNT, AMOUNT]);
      expect(await escrow.state()).to.equal(State.COMPLETED);
    });

    it("U-10 reverts TransferFailed when freelancer is a reverting contract (funds stay FUNDED)", async () => {
      const [client] = await ethers.getSigners();
      const Bad = await ethers.deployContract("MaliciousFreelancer");
      await Bad.setMode(1);
      const escrow = await (await ethers.getContractFactory("FreelanceMilestoneEscrow")).connect(client).deploy(Bad.target);
      await escrow.depositFunds({ value: AMOUNT });
      await expect(escrow.releasePayment()).to.be.revertedWithCustomError(escrow, "TransferFailed");
      expect(await escrow.state()).to.equal(State.FUNDED); // whole tx reverted
      expect(await escrow.getBalance()).to.equal(AMOUNT);
    });
  });

  describe("refundClient (U-11..U-14)", () => {
    it("U-11 reverts Unauthorized for non-freelancer", async () => {
      const { escrow, client, stranger } = await loadFixture(fundedFixture);
      for (const s of [client, stranger]) {
        await expect(escrow.connect(s).refundClient()).to.be.revertedWithCustomError(escrow, "Unauthorized");
      }
    });

    it("U-12 reverts InvalidState outside FUNDED", async () => {
      const { escrow, freelancer } = await loadFixture(deployFixture);
      await expect(escrow.connect(freelancer).refundClient()).to.be.revertedWithCustomError(escrow, "InvalidState");
    });

    it("U-13 success: refunds client in full, REFUNDED, event emitted", async () => {
      const { escrow, client, freelancer } = await loadFixture(fundedFixture);
      const tx = escrow.connect(freelancer).refundClient();
      await expect(tx).to.emit(escrow, "ClientRefunded").withArgs(client.address, AMOUNT);
      await expect(tx).to.changeEtherBalances([escrow, client], [-AMOUNT, AMOUNT]);
      expect(await escrow.state()).to.equal(State.REFUNDED);
    });

    it("U-14 reverts TransferFailed when client is a reverting contract", async () => {
      const [, freelancer] = await ethers.getSigners();
      const proxy = await ethers.deployContract("ClientProxy", [freelancer.address]);
      const escrow = await ethers.getContractAt("FreelanceMilestoneEscrow", await proxy.escrow());
      await proxy.setMode(1);
      await proxy.deposit({ value: AMOUNT });
      await expect(escrow.connect(freelancer).refundClient()).to.be.revertedWithCustomError(escrow, "TransferFailed");
      expect(await escrow.state()).to.equal(State.FUNDED);
      expect(await escrow.getBalance()).to.equal(AMOUNT);
    });
  });

  describe("getBalance (U-15)", () => {
    it("tracks balance across the lifecycle", async () => {
      const { escrow, client } = await loadFixture(deployFixture);
      expect(await escrow.getBalance()).to.equal(0n);
      await escrow.connect(client).depositFunds({ value: AMOUNT });
      expect(await escrow.getBalance()).to.equal(AMOUNT);
      await escrow.connect(client).releasePayment();
      expect(await escrow.getBalance()).to.equal(0n);
    });

    it("returns 0 after REFUNDED", async () => {
      const { escrow, freelancer } = await loadFixture(fundedFixture);
      await escrow.connect(freelancer).refundClient();
      expect(await escrow.getBalance()).to.equal(0n);
    });
  });

  describe("Reentrancy (U-16)", () => {
    it("malicious freelancer cannot re-enter during releasePayment", async () => {
      const [client] = await ethers.getSigners();
      const bad = await ethers.deployContract("MaliciousFreelancer");
      await bad.setMode(2);
      const escrow = await (await ethers.getContractFactory("FreelanceMilestoneEscrow")).connect(client).deploy(bad.target);
      await bad.setEscrow(escrow.target);
      await escrow.depositFunds({ value: AMOUNT });

      await escrow.releasePayment(); // outer call succeeds
      expect(await bad.reentryAttempted()).to.equal(true);
      expect(await bad.refundReentrySucceeded()).to.equal(false);
      expect(await bad.releaseReentrySucceeded()).to.equal(false);
      expect(await bad.refundErrorSelector()).to.equal(escrow.interface.getError("InvalidState").selector);
      expect(await ethers.provider.getBalance(bad.target)).to.equal(AMOUNT); // paid exactly once
      expect(await escrow.state()).to.equal(State.COMPLETED);
    });

    it("malicious client cannot re-enter during refundClient", async () => {
      const [, freelancer] = await ethers.getSigners();
      const proxy = await ethers.deployContract("ClientProxy", [freelancer.address]);
      const escrow = await ethers.getContractAt("FreelanceMilestoneEscrow", await proxy.escrow());
      await proxy.setMode(2);
      await proxy.deposit({ value: AMOUNT });

      await escrow.connect(freelancer).refundClient();
      expect(await proxy.reentryAttempted()).to.equal(true);
      expect(await proxy.reentrySucceeded()).to.equal(false);
      expect(await proxy.reentryErrorSelector()).to.equal(escrow.interface.getError("InvalidState").selector);
      expect(await ethers.provider.getBalance(proxy.target)).to.equal(AMOUNT);
      expect(await escrow.state()).to.equal(State.REFUNDED);
    });
  });

  describe("Integration (I-01..I-06)", () => {
    it("I-01 happy path", async () => {
      const { escrow, client, freelancer } = await loadFixture(deployFixture);
      await escrow.connect(client).depositFunds({ value: AMOUNT });
      await expect(escrow.connect(client).releasePayment()).to.changeEtherBalance(freelancer, AMOUNT);
      expect(await escrow.state()).to.equal(State.COMPLETED);
      expect(await escrow.getBalance()).to.equal(0n);
    });

    it("I-02 refund path", async () => {
      const { escrow, client, freelancer } = await loadFixture(deployFixture);
      await escrow.connect(client).depositFunds({ value: AMOUNT });
      await expect(escrow.connect(freelancer).refundClient()).to.changeEtherBalance(client, AMOUNT);
      expect(await escrow.state()).to.equal(State.REFUNDED);
      expect(await escrow.getBalance()).to.equal(0n);
    });

    it("I-03 out-of-order calls revert InvalidState; terminal states are final", async () => {
      const { escrow, client, freelancer } = await loadFixture(deployFixture);
      await expect(escrow.connect(client).releasePayment()).to.be.revertedWithCustomError(escrow, "InvalidState");
      await expect(escrow.connect(freelancer).refundClient()).to.be.revertedWithCustomError(escrow, "InvalidState");
      await escrow.connect(client).depositFunds({ value: AMOUNT });
      await escrow.connect(client).releasePayment();
      await expect(escrow.connect(client).depositFunds({ value: AMOUNT })).to.be.revertedWithCustomError(escrow, "InvalidState");
      await expect(escrow.connect(freelancer).refundClient()).to.be.revertedWithCustomError(escrow, "InvalidState");
    });

    it("I-04 role violations revert Unauthorized", async () => {
      const { escrow, client, freelancer, stranger } = await loadFixture(fundedFixture);
      await expect(escrow.connect(freelancer).releasePayment()).to.be.revertedWithCustomError(escrow, "Unauthorized");
      await expect(escrow.connect(client).refundClient()).to.be.revertedWithCustomError(escrow, "Unauthorized");
      await expect(escrow.connect(stranger).releasePayment()).to.be.revertedWithCustomError(escrow, "Unauthorized");
      await expect(escrow.connect(stranger).refundClient()).to.be.revertedWithCustomError(escrow, "Unauthorized");
    });

    it("I-05 same-block race: exactly one of release/refund succeeds", async () => {
      const { escrow, client, freelancer } = await loadFixture(fundedFixture);
      await network.provider.send("evm_setAutomine", [false]);
      try {
        const a = await escrow.connect(client).releasePayment({ gasLimit: 200000 });
        const b = await escrow.connect(freelancer).refundClient({ gasLimit: 200000 });
        await network.provider.send("evm_mine");
        const [ra, rb] = [await a.wait().catch((e) => e.receipt), await b.wait().catch((e) => e.receipt)];
        const statuses = [ra.status, rb.status].sort();
        expect(statuses).to.deep.equal([0, 1]);
        const s = await escrow.state();
        expect(s === State.COMPLETED || s === State.REFUNDED).to.equal(true);
        expect(await escrow.getBalance()).to.equal(0n);
      } finally {
        await network.provider.send("evm_setAutomine", [true]);
      }
      // the loser is now rejected as InvalidState (both callers are correctly authorised)
      await expect(escrow.connect(client).releasePayment()).to.be.revertedWithCustomError(escrow, "InvalidState");
      await expect(escrow.connect(freelancer).refundClient()).to.be.revertedWithCustomError(escrow, "InvalidState");
    });

    it("I-06 separate deployments are isolated", async () => {
      const { escrow: e1, Escrow, client, freelancer } = await loadFixture(deployFixture);
      const e2 = await Escrow.connect(client).deploy(freelancer.address);
      await e1.connect(client).depositFunds({ value: AMOUNT });
      expect(await e1.state()).to.equal(State.FUNDED);
      expect(await e2.state()).to.equal(State.AWAITING_PAYMENT);
      expect(await e2.getBalance()).to.equal(0n);
    });
  });

  describe("Security (S-01..S-06)", () => {
    it("S-01 reverting recipient traps funds in FUNDED (documented limitation)", async () => {
      const [client] = await ethers.getSigners();
      const bad = await ethers.deployContract("MaliciousFreelancer");
      await bad.setMode(1);
      const escrow = await (await ethers.getContractFactory("FreelanceMilestoneEscrow")).connect(client).deploy(bad.target);
      await bad.setEscrow(escrow.target);
      await escrow.depositFunds({ value: AMOUNT });
      await expect(escrow.releasePayment()).to.be.revertedWithCustomError(escrow, "TransferFailed");
      // Freelancer contract could refund via callRefund(), but only if it chooses to; funds are otherwise stuck.
      expect(await escrow.getBalance()).to.equal(AMOUNT);
      await bad.setMode(0); // if the recipient starts accepting ETH, release works again
      await expect(escrow.releasePayment()).to.changeEtherBalance(bad, AMOUNT);
    });

    it("S-02 forced ETH inflates getBalance() but invariants hold", async () => {
      const { escrow, client, freelancer } = await loadFixture(fundedFixture);
      const bomb = await ethers.deployContract("ForceSend", { value: ethers.parseEther("0.5") });
      await bomb.attack(escrow.target);
      expect(await escrow.getBalance()).to.equal(AMOUNT + ethers.parseEther("0.5"));
      expect(await escrow.state()).to.equal(State.FUNDED);
      // Extra ETH is simply paid out with the rest (sweeps balance, never gets stuck)
      await expect(escrow.connect(client).releasePayment()).to.changeEtherBalance(freelancer, AMOUNT + ethers.parseEther("0.5"));
      expect(await escrow.getBalance()).to.equal(0n);
    });

    it("S-05 fuzz: random callers can never call any restricted function", async () => {
      const { escrow } = await loadFixture(fundedFixture);
      for (let i = 0; i < 25; i++) {
        const w = ethers.Wallet.createRandom().connect(ethers.provider);
        await network.provider.send("hardhat_setBalance", [w.address, "0x56BC75E2D63100000"]);
        const c = escrow.connect(w);
        await expect(c.depositFunds({ value: 1 })).to.be.revertedWithCustomError(escrow, "Unauthorized");
        await expect(c.releasePayment()).to.be.revertedWithCustomError(escrow, "Unauthorized");
        await expect(c.refundClient()).to.be.revertedWithCustomError(escrow, "Unauthorized");
      }
    });

    it("S-03 direct ETH transfers (no depositFunds) revert", async () => {
      const { escrow, client } = await loadFixture(deployFixture);
      await expect(client.sendTransaction({ to: escrow.target, value: AMOUNT })).to.be.reverted;
      await expect(client.sendTransaction({ to: escrow.target, value: 0, data: "0x12345678" })).to.be.reverted;
      expect(await escrow.getBalance()).to.equal(0n);
    });

    it("S-04 self-dealing (client == freelancer) keeps invariants", async () => {
      const { Escrow, client } = await loadFixture(deployFixture);
      const e = await Escrow.connect(client).deploy(client.address);
      await e.depositFunds({ value: AMOUNT });
      await e.releasePayment();
      expect(await e.state()).to.equal(State.COMPLETED);
      expect(await e.getBalance()).to.equal(0n);
    });

    it("S-06 forced ETH before funding / after a terminal state (documents edge cases)", async () => {
      const { escrow, client } = await loadFixture(deployFixture);
      const half = ethers.parseEther("0.5");
      // before funding: getBalance() is non-zero even though state is AWAITING_PAYMENT
      await (await ethers.deployContract("ForceSend", { value: half })).attack(escrow.target);
      expect(await escrow.state()).to.equal(State.AWAITING_PAYMENT);
      expect(await escrow.getBalance()).to.equal(half);
      await escrow.connect(client).depositFunds({ value: AMOUNT });
      await escrow.connect(client).releasePayment();
      expect(await escrow.getBalance()).to.equal(0n);
      // after a terminal state: forced ETH is permanently locked (no withdraw path)
      await (await ethers.deployContract("ForceSend", { value: half })).attack(escrow.target);
      expect(await escrow.getBalance()).to.equal(half);
      await expect(escrow.connect(client).releasePayment()).to.be.revertedWithCustomError(escrow, "InvalidState");
    });
  });
});
