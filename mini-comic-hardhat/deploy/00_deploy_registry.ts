import type { DeployFunction } from "hardhat-deploy/types";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;
  const { deployer } = await getNamedAccounts();

  const platformFeeRecipient = deployer;
  const platformFeePermille = 20; // 2.0%

  await deploy("MiniComicRegistry", {
    from: deployer,
    log: true,
    args: [platformFeeRecipient, platformFeePermille],
  });
};

export default func;
func.id = "deploy_mini_comic_registry";
func.tags = ["MiniComicRegistry"];




